import { Injectable, Logger } from '@nestjs/common';
import { TelegramClientService } from './telegram-client.service';
import { TelegramSessionService } from './telegram-session.service';

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  constructor(
    private readonly clientService: TelegramClientService,
    private readonly sessionService: TelegramSessionService,
  ) {}

  /**
   * Проверяет статус авторизации
   */
  async getAuthStatus(): Promise<{
    isReady: boolean;
    isConnected: boolean;
    hasSession: boolean;
    userInfo?: any;
  }> {
    try {
      const hasSession = this.sessionService.hasSession();
      const isConnected = this.clientService.isConnected();
      const isReady = this.clientService.isReady();
      
      let userInfo: any = null;

      if (isReady) {
        try {
          userInfo = await this.clientService.getCurrentUser();
        } catch (error) {
          this.logger.warn('Failed to get user info:', error.message);
        }
      }

      return {
        isReady,
        isConnected,
        hasSession,
        userInfo,
      };
    } catch (error) {
      this.logger.error('Failed to check auth status:', error.message);
      return {
        isReady: false,
        isConnected: false,
        hasSession: false,
      };
    }
  }

  /**
   * Принудительная переавторизация
   */
  async forceReauth(): Promise<void> {
    try {
      this.logger.log('Starting forced reauthorization...');
      await this.clientService.reinitialize();
      this.logger.log('Forced reauthorization completed');
    } catch (error) {
      this.logger.error('Forced reauthorization failed:', error.message);
      throw error;
    }
  }

  /**
   * Выход и очистка сессии
   */
  async logout(): Promise<void> {
    try {
      this.logger.log('Logging out and cleaning session...');
      
      await this.clientService.disconnect();
      this.sessionService.clearSession();
      
      this.logger.log('Successfully logged out');
    } catch (error) {
      this.logger.error('Logout failed:', error.message);
      throw error;
    }
  }
}
