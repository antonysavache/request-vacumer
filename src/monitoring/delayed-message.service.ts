import { Injectable, Logger } from '@nestjs/common';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { Api } from 'telegram';

export interface DelayedMessageTask {
  id: string;
  targetUserId: string;
  targetChatId: string;
  message: string;
  scheduledTime: Date;
  originalMessage: {
    text: string;
    chatTitle: string;
    userName: string;
    username?: string;
    messageDate: Date;
  };
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class DelayedMessageService {
  private readonly logger = new Logger(DelayedMessageService.name);
  private pendingMessages: Map<string, DelayedMessageTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private readonly telegramClient: TelegramClientService) {}

  /**
   * Планирует отложенное сообщение
   * @param targetUserId ID пользователя, которому отправляем
   * @param targetChatId ID чата, откуда пришло сообщение  
   * @param message Текст отложенного сообщения
   * @param delayMinutes Задержка в минутах
   * @param originalMessage Информация об оригинальном сообщении
   * @param logChatId ID чата для логирования
   */
  async scheduleDelayedMessage(
    targetUserId: string,
    targetChatId: string,
    message: string,
    delayMinutes: number,
    originalMessage: {
      text: string;
      chatTitle: string;
      userName: string;
      username?: string;
      messageDate: Date;
    },
    logChatId?: string
  ): Promise<string> {
    const taskId = this.generateTaskId();
    const scheduledTime = new Date(Date.now() + delayMinutes * 60 * 1000);

    const task: DelayedMessageTask = {
      id: taskId,
      targetUserId,
      targetChatId,
      message,
      scheduledTime,
      originalMessage,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3
    };

    this.pendingMessages.set(taskId, task);

    // Создаем таймер
    const timer = setTimeout(async () => {
      await this.executeDelayedMessage(taskId, logChatId);
    }, delayMinutes * 60 * 1000);

    this.timers.set(taskId, timer);

    this.logger.log(
      `⏰ Scheduled delayed message for user ${targetUserId} in ${delayMinutes} minutes. Task ID: ${taskId}`
    );

    // Логируем создание отложенного сообщения
    if (logChatId) {
      await this.sendLogMessage(
        logChatId,
        this.formatScheduleLogMessage(task, delayMinutes)
      );
    }

    return taskId;
  }

  /**
   * Выполняет отправку отложенного сообщения
   */
  private async executeDelayedMessage(taskId: string, logChatId?: string): Promise<void> {
    const task = this.pendingMessages.get(taskId);
    if (!task) {
      this.logger.warn(`Task ${taskId} not found`);
      return;
    }

    task.attempts++;
    this.logger.log(`📤 Executing delayed message ${taskId} (attempt ${task.attempts}/${task.maxAttempts})`);

    try {
      const client = this.telegramClient.getClient();
      
      // Отправляем сообщение пользователю
      await client.sendMessage(task.targetUserId, {
        message: task.message,
        parseMode: 'markdown'
      });

      task.status = 'sent';
      this.logger.log(`✅ Delayed message ${taskId} sent successfully`);

      // Логируем успешную отправку
      if (logChatId) {
        await this.sendLogMessage(
          logChatId,
          this.formatSentLogMessage(task)
        );
      }

    } catch (error) {
      this.logger.error(`❌ Failed to send delayed message ${taskId}:`, error.message);
      
      if (task.attempts < task.maxAttempts) {
        // Повторная попытка через 5 минут
        this.scheduleRetry(taskId, 5, logChatId);
      } else {
        task.status = 'failed';
        this.logger.error(`❌ Delayed message ${taskId} failed after ${task.maxAttempts} attempts`);
        
        // Логируем неудачу
        if (logChatId) {
          await this.sendLogMessage(
            logChatId,
            this.formatFailedLogMessage(task, error.message)
          );
        }
      }
    } finally {
      // Очищаем таймер
      const timer = this.timers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(taskId);
      }

      // Если задача завершена (успешно или неудачно), удаляем из pending
      if (task.status === 'sent' || task.status === 'failed') {
        this.pendingMessages.delete(taskId);
      }
    }
  }

  /**
   * Планирует повторную попытку
   */
  private scheduleRetry(taskId: string, delayMinutes: number, logChatId?: string): void {
    const timer = setTimeout(async () => {
      await this.executeDelayedMessage(taskId, logChatId);
    }, delayMinutes * 60 * 1000);

    this.timers.set(taskId, timer);
    this.logger.log(`🔄 Scheduled retry for delayed message ${taskId} in ${delayMinutes} minutes`);
  }

  /**
   * Отменяет отложенное сообщение
   */
  async cancelDelayedMessage(taskId: string): Promise<boolean> {
    const task = this.pendingMessages.get(taskId);
    if (!task) {
      return false;
    }

    // Очищаем таймер
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    // Удаляем задачу
    this.pendingMessages.delete(taskId);
    
    this.logger.log(`❌ Cancelled delayed message ${taskId}`);
    return true;
  }

  /**
   * Получает список всех pending сообщений
   */
  getPendingMessages(): DelayedMessageTask[] {
    return Array.from(this.pendingMessages.values());
  }

  /**
   * Получает информацию о конкретной задаче
   */
  getTask(taskId: string): DelayedMessageTask | undefined {
    return this.pendingMessages.get(taskId);
  }

  /**
   * Генерирует уникальный ID для задачи
   */
  private generateTaskId(): string {
    return `dm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Отправляет сообщение в лог-чат
   */
  private async sendLogMessage(logChatId: string, message: string): Promise<void> {
    try {
      const client = this.telegramClient.getClient();
      await client.sendMessage(logChatId, {
        message,
        parseMode: 'markdown'
      });
    } catch (error) {
      this.logger.error('Failed to send log message:', error.message);
    }
  }

  /**
   * Форматирует сообщение о планировании отложенного сообщения
   */
  private formatScheduleLogMessage(task: DelayedMessageTask, delayMinutes: number): string {
    const scheduledTimeStr = task.scheduledTime.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `⏰ **ОТЛОЖЕННОЕ СООБЩЕНИЕ ЗАПЛАНИРОВАНО**

📝 **Оригинальное сообщение:**
"${task.originalMessage.text}"

👤 **От пользователя:** ${task.originalMessage.userName}${task.originalMessage.username ? ` (@${task.originalMessage.username})` : ''}
💬 **Из чата:** ${task.originalMessage.chatTitle}
⏱️ **Время оригинала:** ${task.originalMessage.messageDate.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}

📤 **Отложенное сообщение:**
"${task.message}"

⏰ **Будет отправлено:** ${scheduledTimeStr} (через ${delayMinutes} мин)
🆔 **ID задачи:** \`${task.id}\``;
  }

  /**
   * Форматирует сообщение об успешной отправке
   */
  private formatSentLogMessage(task: DelayedMessageTask): string {
    const sentTimeStr = new Date().toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `✅ **ОТЛОЖЕННОЕ СООБЩЕНИЕ ОТПРАВЛЕНО**

📤 **Сообщение:** "${task.message}"
👤 **Получателю:** ${task.originalMessage.userName}${task.originalMessage.username ? ` (@${task.originalMessage.username})` : ''}
⏰ **Время отправки:** ${sentTimeStr}
🆔 **ID задачи:** \`${task.id}\``;
  }

  /**
   * Форматирует сообщение о неудачной отправке
   */
  private formatFailedLogMessage(task: DelayedMessageTask, errorMessage: string): string {
    return `❌ **ОТЛОЖЕННОЕ СООБЩЕНИЕ НЕ ДОСТАВЛЕНО**

📤 **Сообщение:** "${task.message}"
👤 **Получателю:** ${task.originalMessage.userName}${task.originalMessage.username ? ` (@${task.originalMessage.username})` : ''}
🔄 **Попыток:** ${task.attempts}/${task.maxAttempts}
❌ **Ошибка:** ${errorMessage}
🆔 **ID задачи:** \`${task.id}\``;
  }
}
