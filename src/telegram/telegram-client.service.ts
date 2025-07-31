import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { TelegramSessionService } from './telegram-session.service';
import { getTelegramConfig } from './telegram.config';
import input from 'input';

@Injectable()
export class TelegramClientService implements OnModuleInit {
  private readonly logger = new Logger(TelegramClientService.name);
  private client: TelegramClient;
  private session: StringSession;
  private isInitialized = false;

  constructor(private readonly sessionService: TelegramSessionService) {}

  async onModuleInit() {
    this.logger.log('Starting Telegram client initialization...');
    await this.initializeAndConnect();
  }

  private async initializeAndConnect(): Promise<void> {
    try {
      const config = getTelegramConfig();
      this.logger.log(`Initializing client for phone: ${config.phoneNumber}`);
      
      // Получаем сессию только из переменных окружения
      const existingSession = this.sessionService.getSessionString();
      
      if (existingSession) {
        this.logger.log('Found existing session in environment variable');
      } else {
        this.logger.log('No session found, will need to authenticate...');
      }

      this.session = new StringSession(existingSession || '');

      // Создаем клиент
      this.client = new TelegramClient(
        this.session,
        config.apiId,
        config.apiHash,
        {
          connectionRetries: 5,
        }
      );

      // Подключаемся и авторизуемся
      await this.connectAndAuth();
      
      this.isInitialized = true;
      this.logger.log('✅ Telegram client successfully initialized and connected');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize Telegram client:', error.message);
      throw error;
    }
  }

  private async connectAndAuth(): Promise<void> {
    try {
      this.logger.log('Connecting to Telegram servers...');
      
      const config = getTelegramConfig();
      
      await this.client.start({
        phoneNumber: async () => {
          this.logger.log(`Using phone number: ${config.phoneNumber}`);
          return config.phoneNumber;
        },
        password: async () => {
          this.logger.log('🔐 Two-factor authentication required');
          return await input.text('Please enter your 2FA password: ');
        },
        phoneCode: async () => {
          this.logger.log('📱 SMS code required');
          return await input.text('Please enter the verification code from SMS: ');
        },
        onError: (err) => {
          this.logger.error('Connection error:', err);
        },
      });

      // Получаем строку сессии для логирования (НЕ сохраняем в файл)
      const sessionString = this.client.session.save() as unknown as string;
      if (sessionString) {
        this.sessionService.logSessionForEnv(sessionString);
      }

      // Получаем информацию о текущем пользователе
      const me = await this.client.getMe();
      this.logger.log(`👤 Logged in as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
      
    } catch (error) {
      this.logger.error('❌ Failed to connect and authenticate:', error.message);
      throw error;
    }
  }

  getClient(): TelegramClient {
    if (!this.client || !this.isInitialized) {
      throw new Error('Telegram client is not initialized. Please wait for initialization to complete.');
    }
    return this.client;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  isReady(): boolean {
    return this.isInitialized && this.isConnected();
  }

  async getCurrentUser() {
    try {
      if (!this.isReady()) {
        throw new Error('Client is not ready');
      }
      return await this.client.getMe();
    } catch (error) {
      this.logger.error('Failed to get current user:', error.message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.logger.log('Disconnected from Telegram');
        this.isInitialized = false;
      }
    } catch (error) {
      this.logger.error('Error disconnecting from Telegram:', error.message);
    }
  }

  /**
   * Полная переинициализация клиента (требует удаления сессии из .env)
   */
  async reinitialize(): Promise<void> {
    try {
      this.logger.log('Reinitializing Telegram client...');
      this.logger.log('⚠️ To perform fresh authentication, remove TELEGRAM_SESSION_STRING from .env file and restart');
      
      // Отключаемся
      await this.disconnect();
      
      // Уведомляем что нужно очистить .env
      this.sessionService.clearSession();
      
      // Переинициализируем
      await this.initializeAndConnect();
      
    } catch (error) {
      this.logger.error('Failed to reinitialize client:', error.message);
      throw error;
    }
  }
}
