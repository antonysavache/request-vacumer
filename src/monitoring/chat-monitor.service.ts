import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { MessageFilterService } from './message-filter.service';
import { DelayedMessageService } from './delayed-message.service';
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
    private readonly delayedMessageService: DelayedMessageService,
  ) {}

  async onModuleInit() {
    try {
      // Загружаем конфигурацию мониторинга
      this.config = getMonitoringConfig();
      
      this.logger.log('📋 EVENT-BASED monitoring configuration:');
      this.logger.log(`🎯 Target chats: ${this.config.targetChats.join(', ')}`);
      this.logger.log(`📝 Keywords: ${this.config.keywords.join(', ')}`);
      this.logger.log(`📤 Forward to: ${this.config.targetChatId}`);
      this.logger.log(`⏰ Delayed messages: ${this.config.delayedMessagesEnabled ? 'ENABLED' : 'DISABLED'}`);
      if (this.config.delayedMessagesEnabled) {
        this.logger.log(`⏱️ Default delay: ${this.config.defaultDelayMinutes} minutes`);
        this.logger.log(`📊 Log chat: ${this.config.logChatId || 'Not set'}`);
      }

      // Ждем готовности Telegram клиента и запускаем мониторинг
      await this.waitForClientAndStartMonitoring();
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize event-based monitor:', error.message);
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

    this.logger.log('✅ Telegram client is ready, starting EVENT-BASED monitoring...');
    await this.startMonitoring();
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('⚠️ Event monitoring is already running');
      return;
    }

    try {
      const client = this.telegramClientService.getClient();
      
      // Проверяем доступность всех чатов
      await this.validateTargetChats();
      
      this.isMonitoring = true;
      this.logger.log('🚀 Starting real-time EVENT monitoring...');

      // Подписываемся на новые сообщения
      client.addEventHandler(this.handleNewMessage.bind(this), new NewMessage({}));

      this.logger.log('👂 Listening for new message EVENTS in real-time...');
      
    } catch (error) {
      this.logger.error('❌ Failed to start event monitoring:', error.message);
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

    this.logger.log(`📊 Monitoring ${validChats.length}/${this.config.targetChats.length} chats via EVENTS`);
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

      this.logger.log(`🎉 NEW MESSAGE EVENT from target chat: ${chatId}`);

      const messageText = message.message;
      const messageDate = new Date(message.date * 1000);
      
      // Получаем информацию о чате и пользователе
      const client = this.telegramClientService.getClient();
      const chatEntity = await client.getEntity(chatId);
      const chatTitle = this.getEntityTitle(chatEntity);
      
      this.logger.log(`💬 Message from: ${chatTitle}`);
      this.logger.log(`📝 Text: "${messageText}"`);
      
      let userName: string | null = null;
      let username: string | null = null;
      let userId: string | null = null;
      
      if (message.fromId) {
        try {
          const userEntity = await client.getEntity(message.fromId);
          userName = this.getUserDisplayName(userEntity);
          username = this.getUserUsername(userEntity);
          userId = message.fromId.userId?.toString() || null;
          
          this.logger.log(`👤 User: ${userName} (${username || 'no username'}) ID: ${userId}`);
          
        } catch (error) {
          this.logger.warn(`Failed to get user info: ${error.message}`);
          userName = 'Unknown User';
          username = null;
          userId = null;
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
          userId,
          filterResult.matchedKeywords,
          messageDate
        );
      }

    } catch (error) {
      this.logger.error('❌ Error handling new message event:', error.message);
    }
  }

  private async forwardMessage(
    originalMessage: string,
    chatTitle: string,
    chatId: string,
    userName: string | null,
    username: string | null,
    userId: string | null,
    matchedKeywords: string[],
    messageDate: Date
  ): Promise<void> {
    try {
      this.logger.log(`📤 Forwarding message from ${chatTitle} to target chat`);
      
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

      // Отправляем в основной чат
      const targetEntity = await client.getEntity(this.config.targetChatId);
      await client.sendMessage(targetEntity, { message: forwardedMessage });
      
      this.logger.log(`✅ Message forwarded successfully (user: ${username || userName})`);

      // Если включены отложенные сообщения и мы можем определить пользователя
      if (this.config.delayedMessagesEnabled && userId && userName) {
        await this.scheduleDelayedResponse(
          originalMessage,
          chatTitle,
          chatId,
          userId,
          userName,
          username,
          messageDate,
          matchedKeywords
        );
      }
      
    } catch (error) {
      this.logger.error(`❌ Failed to forward message: ${error.message}`);
    }
  }

  /**
   * Планирует отложенное сообщение пользователю
   */
  private async scheduleDelayedResponse(
    originalMessage: string,
    chatTitle: string,
    chatId: string,
    userId: string,
    userName: string,
    username: string | null,
    messageDate: Date,
    matchedKeywords: string[]
  ): Promise<void> {
    try {
      // Формируем сообщение для пользователя
      const delayedMessage = this.createDelayedMessage(originalMessage, chatTitle, matchedKeywords);

      const taskId = await this.delayedMessageService.scheduleDelayedMessage(
        userId, // теперь используем реальный userId
        chatId,
        delayedMessage,
        this.config.defaultDelayMinutes!,
        {
          text: originalMessage,
          chatTitle,
          userName,
          username: username || undefined,
          messageDate
        },
        this.config.logChatId
      );

      this.logger.log(`⏰ Scheduled delayed message for ${userName}: ${taskId}`);

    } catch (error) {
      this.logger.error(`❌ Failed to schedule delayed message: ${error.message}`);
    }
  }

  /**
   * Создает текст отложенного сообщения из переменной окружения
   */
  private createDelayedMessage(originalMessage: string, chatTitle: string, matchedKeywords: string[]): string {
    // Просто возвращаем сообщение из конфигурации, без всяких плейсхолдеров
    return this.config.delayedMessage || 'Привет! Пиши в ЛС.';
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
      this.logger.log('🛑 Event monitoring stopped');
    }
  }

  isActive(): boolean {
    return this.isMonitoring;
  }
}
