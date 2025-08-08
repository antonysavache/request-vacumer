import { Injectable, Logger } from '@nestjs/common';
import { TelegramClientService } from './telegram/telegram-client.service';
import { Api } from 'telegram';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly telegramClient: TelegramClientService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getChatHistory(params: {
    fromDate?: string;
    toDate?: string;
    hoursBack?: number;
    chatId?: string;
  }) {
    try {
      const client = this.telegramClient.getClient();
      
      // Используем переданный chatId или дефолтный из env
      const targetChatId = params.chatId || process.env.TARGET_CHATS;
      if (!targetChatId) {
        throw new Error('chatId parameter or TARGET_CHATS environment variable is required');
      }

      this.logger.log(`🔍 Attempting to get chat history for: ${targetChatId}`);

      // Определяем количество часов назад
      let hoursBack = params.hoursBack;
      if (!hoursBack) {
        // Если не передан параметр, берем из переменных окружения или дефолт
        const timeshiftHours = parseInt(process.env.TIMESHIFT_TO_REQUEST || '24');
        hoursBack = timeshiftHours;
      }

      this.logger.log(`⏰ Looking back ${hoursBack} hours`);
      
      let fromDate = params.fromDate;
      if (!fromDate) {
        const hoursAgo = new Date();
        hoursAgo.setHours(hoursAgo.getHours() - hoursBack);
        fromDate = hoursAgo.toISOString();
      }

      this.logger.log(`📅 From date: ${fromDate}`);

      // Проверяем, что клиент подключен
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      let entity;
      try {
        entity = await client.getEntity(targetChatId);
        this.logger.log(`✅ Successfully connected to chat: ${entity.title || targetChatId}`);
      } catch (entityError) {
        this.logger.error(`❌ Failed to get entity for chat ID: ${targetChatId}`);
        this.logger.error(`Entity error: ${entityError.message}`);
        
        // Попробуем другие варианты ID
        const alternativeIds = [
          targetChatId,
          `-100${targetChatId}`,  // Добавляем префикс для супергрупп
          targetChatId.replace('-100', ''), // Убираем префикс если есть
        ];
        
        this.logger.log(`🔄 Trying alternative IDs: ${alternativeIds.join(', ')}`);
        
        let foundEntity = false;
        for (const altId of alternativeIds) {
          try {
            entity = await client.getEntity(altId);
            this.logger.log(`✅ Found chat with ID: ${altId} - ${entity.title || altId}`);
            foundEntity = true;
            break;
          } catch (e) {
            this.logger.log(`❌ ID ${altId} failed: ${e.message}`);
          }
        }
        
        if (!foundEntity) {
          // Попробуем получить список доступных диалогов для отладки
          try {
            this.logger.log(`🔍 Getting available dialogs for debugging...`);
            const dialogs = await client.getDialogs({ limit: 10 });
            
            this.logger.log(`📋 Available dialogs (showing first 10):`);
            for (const dialog of dialogs) {
              const entity = dialog.entity as any;
              const title = entity.title || entity.firstName || 'Unknown';
              const id = entity.id || 'Unknown ID';
              this.logger.log(`  - ${title} (ID: ${id})`);
            }
          } catch (dialogError) {
            this.logger.warn(`Failed to get dialogs: ${dialogError.message}`);
          }
          
          throw new Error(`Could not find chat with any of these IDs: ${alternativeIds.join(', ')}. Check if the bot is added to the target chat and the chat ID is correct.`);
        }
      }

      const fromTimestamp = new Date(fromDate).getTime() / 1000;

      let allMessages: any[] = [];
      let offsetId = 0;
      let shouldContinue = true;
      
      // Собираем всех пользователей из всех запросов
      const allUsers = new Map();
      
      // Получаем список всех диалогов для проверки переписок
      this.logger.log(`🔍 Getting dialogs to check private conversations...`);
      const dialogs = await client.getDialogs({ limit: 100 }); // Увеличиваем лимит для более полной проверки
      const privateDialogs = new Set();
      const privateDialogsByUsername = new Map(); // username -> userId
      
      for (const dialog of dialogs) {
        const entity = dialog.entity as any;
        // Проверяем, что это приватный чат (не группа/канал)
        if (entity.className === 'User' && entity.id) {
          // Приводим ID к числу для консистентности
          const numericId = typeof entity.id === 'object' ? parseInt(entity.id.toString()) : parseInt(entity.id);
          privateDialogs.add(numericId);
          if (entity.username) {
            privateDialogsByUsername.set(entity.username.toLowerCase(), numericId);
          }
          this.logger.debug(`📱 Added private dialog with user ID: ${numericId} (original: ${entity.id}, type: ${typeof entity.id}), username: ${entity.username || 'No username'} (${entity.firstName || 'No name'} ${entity.lastName || ''})`);
        }
      }
      
      this.logger.log(`📱 Found ${privateDialogs.size} private conversations`);
      this.logger.log(`📋 Private dialog IDs: [${Array.from(privateDialogs).join(', ')}]`);
      this.logger.log(`📋 Private dialogs by username: ${JSON.stringify(Object.fromEntries(privateDialogsByUsername))}`);

      while (shouldContinue) {
        const result = await client.invoke(
          new Api.messages.GetHistory({
            peer: entity,
            limit: 100,
            offsetId: offsetId
          })
        );

        if (!('messages' in result) || result.messages.length === 0) {
          break;
        }

        // Собираем пользователей из текущего результата
        if ('users' in result) {
          for (const user of result.users) {
            // Приводим ID к числу для консистентности
            const numericId = typeof (user as any).id === 'object' ? parseInt((user as any).id.toString()) : parseInt((user as any).id.toString());
            allUsers.set(numericId, user);
          }
        }

        for (const msg of result.messages) {
          // Проверяем что сообщение не пустое и имеет дату
          if ((msg as any).date && (msg as any).date >= fromTimestamp) {
            allMessages.push(msg);
            offsetId = (msg as any).id;
          } else if ((msg as any).date && (msg as any).date < fromTimestamp) {
            shouldContinue = false;
            break;
          }
        }

        if (result.messages.length < 100) {
          break;
        }
      }

      const formattedMessages: any[] = [];
      
      for (const msg of allMessages) {
        let fromUsername: string | null = null;
        let fromFirstName: string | null = null;
        let fromLastName: string | null = null;
        let hasPrivateChat: boolean = false;

        // ИСПОЛЬЗУЕМ УЖЕ ПОЛУЧЕННЫХ ПОЛЬЗОВАТЕЛЕЙ ИЗ allUsers
        if (msg.fromId) {
          let userId = msg.fromId;
          
          // Обрабатываем разные форматы fromId
          if (typeof msg.fromId === 'object' && 'userId' in msg.fromId) {
            userId = msg.fromId.userId;
          } else if (typeof msg.fromId === 'object' && '_' in msg.fromId) {
            // Для некоторых версий Telegram API
            userId = (msg.fromId as any)._;
          }
          
          // Приводим к числу для консистентности
          const numericUserId = typeof userId === 'object' ? parseInt(userId.toString()) : parseInt(userId.toString());
          
          this.logger.debug(`👤 Processing message from user ID: ${numericUserId} (original fromId: ${JSON.stringify(msg.fromId)})`);
            
          const user = allUsers.get(numericUserId);
          
          // Проверяем, есть ли переписка с этим пользователем
          hasPrivateChat = privateDialogs.has(numericUserId);
          
          // Дополнительная проверка по username если не найдено по ID
          if (!hasPrivateChat && user && user.username) {
            const usernameNormalized = user.username.toLowerCase();
            hasPrivateChat = privateDialogsByUsername.has(usernameNormalized);
            if (hasPrivateChat) {
              this.logger.debug(`💬 Found private chat for user ${numericUserId} by username: ${user.username}`);
            }
          }
          
          this.logger.log(`💬 USER ANALYSIS: ID=${numericUserId} (type: ${typeof numericUserId}), username=${user?.username || 'none'}, firstName=${user?.firstName || 'none'}, hasPrivateChat=${hasPrivateChat}`);
          this.logger.log(`💬 PRIVATE DIALOGS CHECK: privateDialogs.has(${numericUserId}) = ${privateDialogs.has(numericUserId)} (privateDialogs contains: ${Array.from(privateDialogs).slice(0, 5).map(id => `${id}(${typeof id})`).join(', ')}...)`);
          
          if (user?.username) {
            const usernameCheck = privateDialogsByUsername.has(user.username.toLowerCase());
            this.logger.log(`💬 USERNAME CHECK: privateDialogsByUsername.has('${user.username.toLowerCase()}') = ${usernameCheck}`);
          }
          
          if (user) {
            // Используем данные пользователя из кэша
            fromUsername = user.username ? `@${user.username}` : null;
            fromFirstName = user.firstName || null;
            fromLastName = user.lastName || null;
          } else {
            // Фоллбэк: пытаемся получить пользователя через API
            try {
              const userEntity = await client.getEntity(numericUserId);
              const userName = this.getUserDisplayName(userEntity);
              const username = this.getUserUsername(userEntity);
              
              fromUsername = username;
              // Разбиваем display name на части
              if (userName && userName !== 'Unknown User') {
                const nameParts = userName.replace('@', '').split(' ');
                fromFirstName = nameParts[0] || null;
                fromLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
              }
            } catch (error) {
              this.logger.warn(`Failed to get user info for message ${msg.id}: ${error.message}`);
              // Оставляем все null, что уже установлено выше
            }
          }
        }

        formattedMessages.push({
          message_id: msg.id,
          text: msg.message || '[медиа файл]',
          date: new Date(msg.date * 1000).toISOString(),
          timestamp: msg.date,
          from_username: fromUsername,
          from_first_name: fromFirstName,
          from_last_name: fromLastName,
          has_private_chat: hasPrivateChat
        });
      }

      // Логирование статистики
      const withPrivateChat = formattedMessages.filter(m => m.has_private_chat).length;
      const withoutPrivateChat = formattedMessages.length - withPrivateChat;
      this.logger.log(`📊 Message statistics: ${withPrivateChat} with private chat, ${withoutPrivateChat} without private chat`);

      return {
        success: true,
        data: {
          messages: formattedMessages,
          total_found: formattedMessages.length,
          chat_id: targetChatId,
          timeshift_hours: hoursBack,
          calculated_from_date: fromDate
        }
      };

    } catch (error) {
      this.logger.error('Error fetching chat history:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getAvailableChats() {
    try {
      this.logger.log(`🔍 Getting available chats...`);
      
      const client = this.telegramClient.getClient();
      
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      const dialogs = await client.getDialogs({ limit: 100 });
      const availableChats: any[] = [];
      
      for (const dialog of dialogs) {
        const entity = dialog.entity as any;
        
        // Включаем группы, супергруппы и каналы
        if (entity.className === 'Chat' || entity.className === 'Channel') {
          const chatInfo = {
            id: entity.id.toString(),
            title: entity.title || 'Без названия',
            type: entity.className === 'Channel' ? 
              (entity.broadcast ? 'channel' : 'supergroup') : 'group',
            participants_count: entity.participantsCount || 0,
            username: entity.username || null,
            description: entity.about || null,
            last_message_date: dialog.date ? new Date(dialog.date * 1000).toISOString() : null,
            unread_count: dialog.unreadCount || 0
          };
          
          availableChats.push(chatInfo);
        }
      }

      // Сортируем по дате последнего сообщения
      availableChats.sort((a, b) => {
        if (!a.last_message_date) return 1;
        if (!b.last_message_date) return -1;
        return new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime();
      });

      this.logger.log(`✅ Found ${availableChats.length} available chats`);

      return {
        success: true,
        data: {
          chats: availableChats,
          total_count: availableChats.length
        }
      };

    } catch (error) {
      this.logger.error(`Error getting available chats: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getChatInfo(chatId: string) {
    try {
      this.logger.log(`🔍 Getting info for chat: ${chatId}`);
      
      const client = this.telegramClient.getClient();
      
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      const entity = await client.getEntity(chatId);
      
      const chatInfo = {
        id: chatId,
        title: (entity as any).title || 'Без названия',
        type: (entity as any).className === 'Channel' ? 
          ((entity as any).broadcast ? 'channel' : 'supergroup') : 'group',
        participants_count: (entity as any).participantsCount || 0,
        username: (entity as any).username || null,
        description: (entity as any).about || null,
        is_creator: (entity as any).creator || false,
        is_admin: (entity as any).adminRights ? true : false,
        can_send_messages: (entity as any).defaultBannedRights ? 
          !(entity as any).defaultBannedRights.sendMessages : true
      };

      this.logger.log(`✅ Got chat info: ${chatInfo.title}`);

      return {
        success: true,
        data: chatInfo
      };

    } catch (error) {
      this.logger.error(`Error getting chat info: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getChatStats(chatId: string) {
    try {
      this.logger.log(`📊 Getting stats for chat: ${chatId}`);
      
      const client = this.telegramClient.getClient();
      
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      const entity = await client.getEntity(chatId);
      
      // Получаем последние 100 сообщений для статистики
      const result = await client.invoke(
        new Api.messages.GetHistory({
          peer: entity,
          limit: 100,
          offsetId: 0
        })
      );

      let messageCount = 0;
      let lastMessageDate: string | null = null;
      let activeUsers = new Set<string>();

      if ('messages' in result && result.messages.length > 0) {
        messageCount = result.messages.length;
        
        // Получаем дату последнего сообщения
        const lastMsg = result.messages[0] as any;
        if (lastMsg.date) {
          lastMessageDate = new Date(lastMsg.date * 1000).toISOString();
        }

        // Считаем уникальных пользователей
        for (const msg of result.messages) {
          if ((msg as any).fromId) {
            let userId = (msg as any).fromId;
            if (typeof userId === 'object' && 'userId' in userId) {
              userId = userId.userId;
            }
            activeUsers.add(userId.toString());
          }
        }
      }

      const stats = {
        chat_id: chatId,
        title: (entity as any).title || 'Без названия',
        recent_messages_count: messageCount,
        active_users_count: activeUsers.size,
        last_message_date: lastMessageDate,
        participants_count: (entity as any).participantsCount || 0,
        generated_at: new Date().toISOString()
      };

      this.logger.log(`✅ Generated stats for chat: ${stats.title}`);

      return {
        success: true,
        data: stats
      };

    } catch (error) {
      this.logger.error(`Error getting chat stats: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private getUserDisplayName(entity: any): string {
    if (entity?.firstName && entity?.lastName) {
      return `${entity.firstName} ${entity.lastName}`;
    }
    if (entity?.firstName) {
      return entity.firstName;
    }
    if (entity?.username) {
      return `@${entity.username}`;
    }
    return 'Unknown User';
  }

  private getUserUsername(entity: any): string | null {
    if (entity?.username) {
      return `@${entity.username}`;
    }
    return null;
  }

  async sendPrivateMessage(userId: string, message: string, parseMode?: 'markdown' | 'html') {
    try {
      this.logger.log(`📤 Sending message to user: ${userId}`);
      
      const client = this.telegramClient.getClient();
      
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      if (!userId || !message) {
        throw new Error('userId and message are required');
      }

      if (message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      // Получаем пользователя
      let userEntity;
      try {
        userEntity = await client.getEntity(userId);
      } catch (error) {
        throw new Error(`User not found: ${userId}`);
      }

      // Отправляем сообщение
      const sendOptions: any = { message };
      if (parseMode) {
        sendOptions.parseMode = parseMode;
      }

      const sentMessage = await client.sendMessage(userEntity, sendOptions);
      
      this.logger.log(`✅ Message sent to ${userId}`);

      return {
        success: true,
        data: {
          message_id: sentMessage.id,
          to_user_id: userEntity.id,
          message,
          sent_at: new Date().toISOString()
        }
      };

    } catch (error) {
      this.logger.error(`Error sending message: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async debugPrivateDialogs() {
    try {
      this.logger.log(`🔧 Debug: Getting all private dialogs...`);
      
      const client = this.telegramClient.getClient();
      
      if (!this.telegramClient.isReady()) {
        throw new Error('Telegram client is not ready');
      }

      const dialogs = await client.getDialogs({ limit: 100 });
      const privateDialogs: any[] = [];
      
      for (const dialog of dialogs) {
        const entity = dialog.entity as any;
        if (entity.className === 'User') {
          privateDialogs.push({
            id: entity.id,
            username: entity.username || null,
            first_name: entity.firstName || null,
            last_name: entity.lastName || null,
            is_bot: entity.bot || false,
            is_verified: entity.verified || false,
            last_message_date: dialog.date ? new Date(dialog.date * 1000).toISOString() : null
          });
        }
      }

      this.logger.log(`🔧 Debug: Found ${privateDialogs.length} private dialogs`);

      return {
        success: true,
        data: {
          private_dialogs: privateDialogs,
          total_count: privateDialogs.length
        }
      };

    } catch (error) {
      this.logger.error(`Error getting private dialogs: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}
