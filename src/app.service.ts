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
  }) {
    try {
      const client = this.telegramClient.getClient();
      
      const targetChatId = process.env.TARGET_CHATS;
      if (!targetChatId) {
        throw new Error('TARGET_CHATS environment variable is not set');
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
      
      for (const dialog of dialogs) {
        const entity = dialog.entity as any;
        // Проверяем, что это приватный чат (не группа/канал)
        if (entity.className === 'User' && entity.id) {
          privateDialogs.add(entity.id);
          this.logger.debug(`📱 Added private dialog with user ID: ${entity.id} (${entity.firstName || 'No name'} ${entity.lastName || ''})`);
        }
      }
      
      this.logger.log(`📱 Found ${privateDialogs.size} private conversations`);
      this.logger.debug(`📋 Private dialog IDs: [${Array.from(privateDialogs).join(', ')}]`);

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
            allUsers.set((user as any).id, user);
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
          
          // Приводим к числу если это строка
          if (typeof userId === 'string') {
            userId = parseInt(userId);
          }
          
          this.logger.debug(`👤 Processing message from user ID: ${userId} (original fromId: ${JSON.stringify(msg.fromId)})`);
            
          const user = allUsers.get(userId);
          
          // Проверяем, есть ли переписка с этим пользователем
          hasPrivateChat = privateDialogs.has(userId);
          
          this.logger.debug(`💬 User ${userId} has private chat: ${hasPrivateChat}`);
          
          if (user) {
            // Используем данные пользователя из кэша
            fromUsername = user.username ? `@${user.username}` : null;
            fromFirstName = user.firstName || null;
            fromLastName = user.lastName || null;
          } else {
            // Фоллбэк: пытаемся получить пользователя через API
            try {
              const userEntity = await client.getEntity(userId);
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
