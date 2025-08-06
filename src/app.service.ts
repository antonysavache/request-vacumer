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
    limit: number | null;
  }) {
    try {
      const client = this.telegramClient.getClient();
      
      const targetChatId = process.env.TARGET_CHATS;
      if (!targetChatId) {
        throw new Error('TARGET_CHATS environment variable is not set');
      }

      const timeshiftHours = parseInt(process.env.TIMESHIFT_TO_REQUEST || '24');
      
      let fromDate = params.fromDate;
      if (!fromDate) {
        const hoursAgo = new Date();
        hoursAgo.setHours(hoursAgo.getHours() - timeshiftHours);
        fromDate = hoursAgo.toISOString();
      }

      const entity = await client.getEntity(targetChatId);
      const fromTimestamp = new Date(fromDate).getTime() / 1000;

      let allMessages: any[] = [];
      let offsetId = 0;
      let shouldContinue = true;
      
      // Собираем всех пользователей и чаты
      const users = new Map();
      const chats = new Map();

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

        // Собираем информацию о пользователях и чатах из каждого запроса
        if ('users' in result) {
          for (const user of result.users) {
            users.set((user as any).id, user);
          }
        }
        
        if ('chats' in result) {
          for (const chat of result.chats) {
            chats.set((chat as any).id, chat);
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

      const formattedMessages = allMessages.map((msg: any) => {
        let fromUser: any = null;
        let chatInfo: any = null;

        // Получаем информацию об отправителе
        if (msg.fromId) {
          const userId = msg.fromId.userId || msg.fromId.channelId;
          if (userId) {
            const user = users.get(userId);
            if (user) {
              fromUser = {
                id: user.id,
                username: user.username || null,
                first_name: user.firstName || null,
                last_name: user.lastName || null,
                is_bot: user.bot || false
              };
            }
          }
        }

        // Получаем информацию о чате
        if (msg.peerId) {
          const chatId = msg.peerId.chatId || msg.peerId.channelId;
          if (chatId) {
            const chat = chats.get(chatId);
            if (chat) {
              chatInfo = {
                id: chat.id,
                title: chat.title || null,
                username: chat.username || null,
                type: chat.className || 'unknown'
              };
            }
          }
        }

        return {
          message_id: msg.id,
          text: msg.message || '[медиа файл]',
          date: new Date(msg.date * 1000).toISOString(),
          timestamp: msg.date,
          from_user: fromUser,
          chat: chatInfo,
          message_type: msg.className || 'message'
        };
      });

      return {
        success: true,
        data: {
          messages: formattedMessages,
          total_found: formattedMessages.length,
          chat_id: targetChatId,
          timeshift_hours: timeshiftHours,
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
}
