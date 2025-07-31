import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TelegramSessionService {
  private readonly logger = new Logger(TelegramSessionService.name);

  /**
   * Получает строку сессии из переменных окружения
   */
  getSessionString(): string | null {
    const envSession = process.env.TELEGRAM_SESSION_STRING;
    if (envSession && envSession.trim()) {
      this.logger.log('Using session from environment variable');
      return envSession.trim();
    }

    this.logger.log('No session found in environment variable');
    return null;
  }

  /**
   * Проверяет, существует ли сессия
   */
  hasSession(): boolean {
    const sessionString = this.getSessionString();
    return sessionString !== null && sessionString.length > 0;
  }

  /**
   * Логирует сессию для копирования в .env (только для отладки)
   */
  logSessionForEnv(sessionString: string): void {
    this.logger.log('✅ Authentication successful!');
    this.logger.log('📋 Session string for .env file:');
    this.logger.log(`TELEGRAM_SESSION_STRING=${sessionString}`);
    this.logger.log('💡 Copy this line to your .env file');
  }

  /**
   * Заглушки для совместимости (больше не используются)
   */
  saveSessionString(sessionString: string): void {
    this.logger.log('💡 Session ready for .env file');
    this.logSessionForEnv(sessionString);
  }

  clearSession(): void {
    this.logger.log('🗑️ To clear session, remove TELEGRAM_SESSION_STRING from .env file');
  }
}
