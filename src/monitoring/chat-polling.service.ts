import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { MessageFilterService } from './message-filter.service';
import { getMonitoringConfig, MonitoringConfig } from './monitoring.config';

interface ProcessedMessage {
  id: number;
  chatId: string;
  timestamp: number;
}

@Injectable()
export class ChatPollingService implements OnModuleInit {
  private readonly logger = new Logger(ChatPollingService.name);
  private config: MonitoringConfig;
  private isPolling = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private processedMessages: Map<string, Set<number>> = new Map(); // chatId -> Set of message IDs
  private readonly POLLING_INTERVAL = 30000; // 30 секунд
  private readonly MESSAGES_LIMIT = 10; // проверяем последние 10 сообщений

  constructor(
    private readonly telegramClientService: TelegramClientService,
    private readonly messageFilterService: MessageFilterService,
  ) {}

  async onModuleInit() {
    try {
      // Загружаем конфигурацию мониторинга
      this.config = getMonitoringConfig();
      
      this.logger.log('📋 TARGETED Polling configuration loaded:');
      this.logger.log(`🎯 Target chats from ENV: ${this.config.targetChats.join(', ')}`);
      this.logger.log(`📝 Keywords: ${this.config.keywords.join(', ')}`);
      this.logger.log(`📤 Forward to: ${this.config.targetChatId}`);
      this.logger.log(`⏰ Polling interval: ${this.POLLING_INTERVAL / 1000} seconds`);
      this.logger.log(`📊 Messages per check: ${this.MESSAGES_LIMIT}`);
      this.logger.log(`✅ Will ONLY poll chats from TARGET_CHATS env variable`);
      
      if (this.config.excludeKeywords) {
        this.logger.log(`🚫 Exclude keywords: ${this.config.excludeKeywords.join(', ')}`);
      }
      
      if (this.config.minMessageLength) {
        this.logger.log(`📏 Min message length: ${this.config.minMessageLength}`);
      }

      // Инициализируем Set для каждого целевого чата
      this.config.targetChats.forEach(chatId => {
        this.processedMessages.set(chatId, new Set());
        this.logger.log(`📋 Initialized tracking for chat: ${chatId}`);
      });

      // Ждем готовности Telegram клиента и запускаем polling
      await this.waitForClientAndStartPolling();
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize targeted polling:', error.message);
    }
  }

  private async waitForClientAndStartPolling(): Promise<void> {
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

    this.logger.log('✅ Telegram client is ready, starting TARGETED polling...');
    await this.startPolling();
  }

  async startPolling(): Promise<void> {
    if (this.isPolling) {
      this.logger.warn('⚠️ Polling is already running');
      return;
    }

    try {
      const client = this.telegramClientService.getClient();
      
      // Проверяем доступность ТОЛЬКО целевых чатов
      await this.validateTargetChats();
      
      this.isPolling = true;
      this.logger.log('🚀 Starting TARGETED polling...');

      // Инициализируем processed messages для каждого целевого чата
      await this.initializeProcessedMessages();

      // Запускаем интервальный polling ТОЛЬКО для целевых чатов
      this.pollingInterval = setInterval(async () => {
        await this.pollTargetChats();
      }, this.POLLING_INTERVAL);

      this.logger.log(`👂 Polling started - checking ONLY target chats every ${this.POLLING_INTERVAL / 1000} seconds`);
      
      // Делаем первый запрос сразу
      await this.pollTargetChats();
      
    } catch (error) {
      this.logger.error('❌ Failed to start targeted polling:', error.message);
      this.isPolling = false;
    }
  }

  private async validateTargetChats(): Promise<void> {
    this.logger.log('🔍 Validating ONLY target chats from env...');
    
    const client = this.telegramClientService.getClient();
    const validChats: string[] = [];

    for (const chatId of this.config.targetChats) {
      try {
        const entity = await client.getEntity(chatId);
        const chatTitle = this.getEntityTitle(entity);
        validChats.push(chatId);
        this.logger.log(`✅ Target chat accessible: ${chatTitle} (${chatId})`);
      } catch (error) {
        this.logger.error(`❌ Target chat not accessible: ${chatId} - ${error.message}`);
      }
    }

    if (validChats.length === 0) {
      throw new Error('No accessible target chats found in TARGET_CHATS env');
    }

    this.logger.log(`📊 Will poll ${validChats.length}/${this.config.targetChats.length} target chats`);
  }

  private async initializeProcessedMessages(): Promise<void> {
    this.logger.log('🔄 Initializing processed messages cache for TARGET chats...');
    
    const client = this.telegramClientService.getClient();

    // Инициализируем ТОЛЬКО для чатов из env
    for (const chatId of this.config.targetChats) {
      try {
        this.logger.log(`📋 Initializing chat: ${chatId}`);
        const entity = await client.getEntity(chatId);
        const chatTitle = this.getEntityTitle(entity);
        
        const messages = await client.getMessages(entity, { limit: this.MESSAGES_LIMIT });
        
        const processedSet = this.processedMessages.get(chatId) || new Set();
        messages.forEach(msg => {
          if (msg.id) {
            processedSet.add(msg.id);
          }
        });
        this.processedMessages.set(chatId, processedSet);
        
        this.logger.log(`📋 Initialized ${processedSet.size} messages for target chat: ${chatTitle} (${chatId})`);
        
        // Небольшая задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        this.logger.error(`❌ Failed to initialize target chat ${chatId}: ${error.message}`);
      }
    }
  }

  private async pollTargetChats(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    this.logger.log('🔄 Polling TARGET chats for new messages...');
    
    const client = this.telegramClientService.getClient();
    let totalNewMessages = 0;

    // Опрашиваем ТОЛЬКО чаты из TARGET_CHATS
    for (const chatId of this.config.targetChats) {
      try {
        this.logger.log(`🔍 Checking TARGET chat: ${chatId}`);
        
        const entity = await client.getEntity(chatId);
        const chatTitle = this.getEntityTitle(entity);
        
        const messages = await client.getMessages(entity, { limit: this.MESSAGES_LIMIT });
        const processedSet = this.processedMessages.get(chatId) || new Set();
        
        // Фильтруем только новые сообщения
        const newMessages = messages.filter(msg => 
          msg.id && !processedSet.has(msg.id) && msg.message
        );

        if (newMessages.length > 0) {
          this.logger.log(`📝 Found ${newMessages.length} new messages in ${chatTitle} (${chatId})`);
          
          // Обрабатываем новые сообщения (в хронологическом порядке)
          const sortedMessages = newMessages.sort((a, b) => a.date - b.date);
          
          for (const message of sortedMessages) {
            await this.processNewMessage(message, chatId, chatTitle);
            
            // Добавляем в processed
            processedSet.add(message.id);
            totalNewMessages++;
          }
          
          this.processedMessages.set(chatId, processedSet);
        } else {
          this.logger.log(`📭 No new messages in ${chatTitle} (${chatId})`);
        }
        
        // Небольшая задержка между чатами
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        this.logger.error(`❌ Failed to poll target chat ${chatId}: ${error.message}`);
      }
    }

    if (totalNewMessages > 0) {
      this.logger.log(`✅ Polling complete: processed ${totalNewMessages} new messages from TARGET chats`);
    } else {
      this.logger.log(`📭 Polling complete: no new messages in TARGET chats`);
    }
  }

  private async processNewMessage(message: any, chatId: string, chatTitle: string): Promise<void> {
    try {
      const messageText = message.message;
      const messageDate = new Date(message.date * 1000);
      
      this.logger.log(`📝 Processing message from TARGET chat ${chatTitle}: "${messageText}"`);
      this.logger.log(`⏰ Message date: ${messageDate.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
      
      // Получаем информацию о пользователе
      let userName: string | null = null;
      let username: string | null = null;
      
      if (message.fromId) {
        try {
          const client = this.telegramClientService.getClient();
          const userEntity = await client.getEntity(message.fromId);
          userName = this.getUserDisplayName(userEntity);
          username = this.getUserUsername(userEntity);
          
          this.logger.log(`👤 User info: name="${userName}", username="${username}"`);
          
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
      this.logger.error('❌ Error processing new message:', error.message);
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
      this.logger.log(`📤 Preparing to forward message from TARGET chat to ${this.config.targetChatId}`);
      
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
      
      this.logger.log(`✅ Message forwarded successfully from TARGET chat ${chatTitle} (user: ${username || userName})`);
      
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

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    if (this.isPolling) {
      this.isPolling = false;
      this.logger.log('🛑 Targeted polling stopped');
    }
  }

  isActive(): boolean {
    return this.isPolling;
  }
}
