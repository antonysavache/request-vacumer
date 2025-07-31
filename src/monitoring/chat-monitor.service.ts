import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { MessageFilterService } from './message-filter.service';
import { getMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { NewMessage } from 'telegram/events';

@Injectable()
export class ChatMonitorService implements OnModuleInit {
  private readonly logger = new Logger(ChatMonitorService.name);
  private config: MonitoringConfig;
  private isMonitoring = false;

  constructor(
    private readonly telegramClientService: TelegramClientService,
    private readonly messageFilterService: MessageFilterService,
  ) {}

  async onModuleInit() {
    try {
      // Загружаем конфигурацию мониторинга
      this.config = getMonitoringConfig();
      
      this.logger.log('📋 Monitoring configuration loaded:');
      this.logger.log(`🎯 Target chats: ${this.config.targetChats.length} chats`);
      this.logger.log(`📝 Keywords: ${this.config.keywords.join(', ')}`);
      this.logger.log(`📤 Forward to: ${this.config.targetChatId}`);
      
      if (this.config.excludeKeywords) {
        this.logger.log(`🚫 Exclude keywords: ${this.config.excludeKeywords.join(', ')}`);
      }
      
      if (this.config.minMessageLength) {
        this.logger.log(`📏 Min message length: ${this.config.minMessageLength}`);
      }

      // Ждем готовности Telegram клиента и запускаем мониторинг
      await this.waitForClientAndStartMonitoring();
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize chat monitor:', error.message);
    }
  }

  private async waitForClientAndStartMonitoring(): Promise<void> {
    this.logger.log('⏳ Waiting for Telegram client to be ready...');
    
    let attempts = 0;
    while (!this.telegramClientService.isReady() && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (!this.telegramClientService.isReady()) {
      this.logger.error('❌ Telegram client failed to initialize within 60 seconds');
      return;
    }

    this.logger.log('✅ Telegram client is ready, starting chat monitoring...');
    await this.startMonitoring();
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('⚠️ Monitoring is already running');
      return;
    }

    try {
      const client = this.telegramClientService.getClient();
      
      // Проверяем доступность всех чатов
      await this.validateTargetChats();
      
      this.isMonitoring = true;
      this.logger.log('🚀 Starting real-time chat monitoring...');

      // Подписываемся на новые сообщения используя правильный API
      client.addEventHandler(this.handleNewMessage.bind(this), new NewMessage({}));

      this.logger.log('👂 Listening for new messages in target chats...');
      
    } catch (error) {
      this.logger.error('❌ Failed to start monitoring:', error.message);
      this.isMonitoring = false;
    }
  }

  private async validateTargetChats(): Promise<void> {
    this.logger.log('🔍 Validating target chats...');
    
    const client = this.telegramClientService.getClient();
    const validChats: string[] = [];

    for (const chatId of this.config.targetChats) {
      try {
        const entity = await client.getEntity(chatId);
        const chatTitle = this.getEntityTitle(entity);
        validChats.push(chatId);
        this.logger.log(`✅ Chat accessible: ${chatTitle} (${chatId})`);
      } catch (error) {
        this.logger.error(`❌ Chat not accessible: ${chatId} - ${error.message}`);
      }
    }

    if (validChats.length === 0) {
      throw new Error('No accessible target chats found');
    }

    this.logger.log(`📊 Monitoring ${validChats.length}/${this.config.targetChats.length} chats`);
  }

  private async handleNewMessage(event: any): Promise<void> {
    try {
      // Получаем сообщение из события
      const message = event.message;
      if (!message || !message.message) {
        return; // Пропускаем пустые сообщения
      }

      // Получаем ID чата из события
      let chatId: string;
      
      if (message.peerId) {
        if (message.peerId.className === 'PeerChannel') {
          chatId = `-100${message.peerId.channelId}`;
        } else if (message.peerId.className === 'PeerChat') {
          chatId = `-${message.peerId.chatId}`;
        } else {
          return; // Пропускаем личные сообщения
        }
      } else {
        return;
      }
      
      // Проверяем, что сообщение из одного из отслеживаемых чатов
      if (!this.config.targetChats.includes(chatId)) {
        return;
      }

      const messageText = message.message;
      const messageDate = new Date(message.date * 1000);
      
      // Получаем информацию о чате и пользователе
      const client = this.telegramClientService.getClient();
      const chatEntity = await client.getEntity(chatId);
      const chatTitle = this.getEntityTitle(chatEntity);
      
      let userName: string | null = null;
      let username: string | null = null;
      
      if (message.fromId) {
        try {
          const userEntity = await client.getEntity(message.fromId);
          userName = this.getUserDisplayName(userEntity);
          username = this.getUserUsername(userEntity);
          
          // Логируем для отладки
          this.logger.debug(`User info: name="${userName}", username="${username}"`);
          
        } catch (error) {
          this.logger.warn(`Failed to get user info: ${error.message}`);
          userName = 'Unknown User';
          username = null;
        }
      }

      // Фильтруем сообщение
      const filterResult = this.messageFilterService.filterMessage(messageText, this.config);
      
      // Логируем результат
      this.messageFilterService.logFilterResult(chatTitle, messageText, filterResult);

      // Если сообщение подходит - пересылаем
      if (filterResult.shouldForward) {
        await this.forwardMessage(
          messageText,
          chatTitle,
          chatId,
          userName,
          username,
          filterResult.matchedKeywords,
          messageDate
        );
      }

    } catch (error) {
      this.logger.error('❌ Error handling new message:', error.message);
    }
  }

  private async forwardMessage(
    originalMessage: string,
    chatTitle: string,
    chatId: string,
    userName: string | null,
    username: string | null,
    matchedKeywords: string[],
    messageDate: Date
  ): Promise<void> {
    try {
      const client = this.telegramClientService.getClient();
      
      const forwardedMessage = this.messageFilterService.formatForwardMessage(
        originalMessage,
        chatTitle,
        chatId,
        userName,
        username,
        matchedKeywords,
        messageDate
      );

      const targetEntity = await client.getEntity(this.config.targetChatId);
      await client.sendMessage(targetEntity, { message: forwardedMessage });
      
      this.logger.log(`📤 Message forwarded from ${chatTitle} to target chat (user: ${username || userName})`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to forward message: ${error.message}`);
    }
  }

  private getEntityTitle(entity: any): string {
    return entity?.title || entity?.firstName || 'Unknown Chat';
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

  stopMonitoring(): void {
    if (this.isMonitoring) {
      this.isMonitoring = false;
      this.logger.log('🛑 Chat monitoring stopped');
    }
  }

  isActive(): boolean {
    return this.isMonitoring;
  }
}
