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

      const formattedMessages = allMessages.map((msg: any) => ({
        message_id: msg.id,
        text: msg.message || '[медиа файл]',
        date: new Date(msg.date * 1000).toISOString(),
        timestamp: msg.date
      }));

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
