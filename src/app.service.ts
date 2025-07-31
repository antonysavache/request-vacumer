import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramClientService } from './telegram/telegram-client.service';
import { getMonitoringConfig } from './monitoring/monitoring.config';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly telegramClientService: TelegramClientService,
  ) {}

  async onModuleInit() {
    try {
      // Проверяем все необходимые переменные окружения
      const requiredEnvVars = [
        'TELEGRAM_API_ID',
        'TELEGRAM_API_HASH',
        'TARGET_CHATS',
        'KEYWORDS',
        'TARGET_CHAT_ID'
      ];

      const missingVars = requiredEnvVars.filter(varName => {
        const value = process.env[varName];
        return !value || value.trim().length === 0 || 
               value === 'your_api_id' || value === 'your_api_hash' ||
               value === 'your_phone_number';
      });

      if (missingVars.length > 0) {
        this.logger.error('❌ Missing required environment variables:');
        missingVars.forEach(varName => {
          this.logger.error(`   - ${varName}`);
        });
        this.logger.log('💡 Please fill all required variables in .env file');
        return;
      }

      // Проверяем и выводим конфигурацию мониторинга
      try {
        const config = getMonitoringConfig();
        this.logger.log('✅ Monitoring configuration validated:');
        this.logger.log(`🎯 Monitoring ${config.targetChats.length} chats`);
        this.logger.log(`📝 Looking for ${config.keywords.length} keywords`);
        this.logger.log(`📤 Forwarding to: ${config.targetChatId}`);
      } catch (configError) {
        this.logger.error('❌ Invalid monitoring configuration:', configError.message);
        return;
      }

      // Проверяем наличие session string
      const sessionString = process.env.TELEGRAM_SESSION_STRING;
      if (!sessionString || sessionString.trim().length === 0) {
        this.logger.warn('⚠️ TELEGRAM_SESSION_STRING not found in .env file');
        this.logger.log('📋 First run: will require phone authentication');
        this.logger.log('💡 Copy session string from logs to .env for server deployment');
        this.logger.log('');
      }

      // Отправляем тестовое сообщение для проверки
      await this.sendTestMessage();
      
    } catch (error) {
      this.logger.error('Application error:', error.message);
    }
  }

  private async sendTestMessage() {
    this.logger.log('📤 Starting test message sending...');
    
    try {
      // Ждем пока клиент будет готов
      if (!this.telegramClientService.isReady()) {
        this.logger.log('⏳ Waiting for Telegram client to be ready...');
        let attempts = 0;
        while (!this.telegramClientService.isReady() && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }
        
        if (!this.telegramClientService.isReady()) {
          this.logger.error('❌ Telegram client failed to initialize within 30 seconds');
          return;
        }
      }
      
      const client = this.telegramClientService.getClient();
      const config = getMonitoringConfig();
      const testMessage = `🚀 Request Vacuumer Started!

⏰ Started at: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🎯 Monitoring ${config.targetChats.length} chats
📝 Keywords: ${config.keywords.join(', ')}
✅ System is ready and monitoring!`;
      
      this.logger.log(`📝 Sending startup notification to: ${config.targetChatId}`);
      
      try {
        const entity = await client.getEntity(config.targetChatId);
        await client.sendMessage(entity, { message: testMessage });
        
        this.logger.log('✅ Startup notification sent successfully!');
        this.logger.log('🎉 Request Vacuumer is now monitoring chats...');
      } catch (sendError) {
        this.logger.error(`❌ Failed to send startup notification: ${sendError.message}`);
      }
      
    } catch (error) {
      this.logger.error('❌ Test message failed:', error.message);
    }
  }

  getHello(): string {
    return 'Request Vacuumer - Telegram Chat Monitor';
  }
}
