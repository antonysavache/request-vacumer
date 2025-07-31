import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { getMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { Raw } from 'telegram/events';

@Injectable()
export class RawEventsService implements OnModuleInit {
  private readonly logger = new Logger(RawEventsService.name);
  private config: MonitoringConfig;
  private isListening = false;
  private readonly TARGET_CHAT_ID = '-1001787758104'; // Фильтр для конкретного чата

  constructor(
    private readonly telegramClientService: TelegramClientService,
  ) {}

  async onModuleInit() {
    try {
      this.config = getMonitoringConfig();
      this.logger.log(`🎯 Raw events filter: ONLY chat ${this.TARGET_CHAT_ID}`);
      await this.waitForClientAndStartListening();
    } catch (error) {
      this.logger.error('❌ Failed to initialize raw events listener:', error.message);
    }
  }

  private async waitForClientAndStartListening(): Promise<void> {
    let attempts = 0;
    while (!this.telegramClientService.isReady() && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (!this.telegramClientService.isReady()) {
      this.logger.error('❌ Telegram client failed to initialize within 60 seconds');
      return;
    }

    await this.startListening();
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;

    try {
      const client = this.telegramClientService.getClient();
      this.isListening = true;
      
      client.addEventHandler(this.handleRawEvent.bind(this), new Raw({}));
      this.logger.log(`👂 Raw events listener started (filtering chat ${this.TARGET_CHAT_ID})`);
    } catch (error) {
      this.logger.error('❌ Failed to start raw events listening:', error.message);
      this.isListening = false;
    }
  }

  private async handleRawEvent(update: any): Promise<void> {
    try {
      // Проверяем только события с сообщениями
      if (!update.message) {
        return;
      }

      let chatId: string | null = null;
      
      // Определяем ID чата
      if (update.message.peerId) {
        if (update.message.peerId.className === 'PeerChannel') {
          chatId = `-100${update.message.peerId.channelId}`;
        } else if (update.message.peerId.className === 'PeerChat') {
          chatId = `-${update.message.peerId.chatId}`;
        }
      }

      // ФИЛЬТР: логируем только если это наш целевой чат
      if (chatId === this.TARGET_CHAT_ID) {
        console.log('🎯 TARGET CHAT EVENT:');
        console.log(JSON.stringify(update, null, 2));
        console.log('─'.repeat(80));
      }

    } catch (error) {
      console.error('Error in raw event:', error);
    }
  }

  stopListening(): void {
    if (this.isListening) {
      this.isListening = false;
      this.logger.log('🛑 Raw events listening stopped');
    }
  }

  isActive(): boolean {
    return this.isListening;
  }
}
