import { Injectable, Logger } from '@nestjs/common';
import { MonitoringConfig } from './monitoring.config';

export interface FilterResult {
  shouldForward: boolean;
  matchedKeywords: string[];
  reason?: string;
}

@Injectable()
export class MessageFilterService {
  private readonly logger = new Logger(MessageFilterService.name);

  /**
   * Проверяет сообщение на соответствие фильтрам
   */
  filterMessage(messageText: string, config: MonitoringConfig): FilterResult {
    if (!messageText || messageText.trim().length === 0) {
      return {
        shouldForward: false,
        matchedKeywords: [],
        reason: 'Empty message'
      };
    }

    const normalizedText = messageText.toLowerCase().trim();

    // Проверка минимальной длины сообщения
    if (config.minMessageLength && normalizedText.length < config.minMessageLength) {
      return {
        shouldForward: false,
        matchedKeywords: [],
        reason: `Message too short (${normalizedText.length} < ${config.minMessageLength})`
      };
    }

    // Проверка исключающих ключевых слов
    if (config.excludeKeywords && config.excludeKeywords.length > 0) {
      const foundExcludeKeywords = config.excludeKeywords.filter(keyword => 
        normalizedText.includes(keyword)
      );

      if (foundExcludeKeywords.length > 0) {
        return {
          shouldForward: false,
          matchedKeywords: [],
          reason: `Contains exclude keywords: ${foundExcludeKeywords.join(', ')}`
        };
      }
    }

    // Проверка основных ключевых слов
    const matchedKeywords = config.keywords.filter(keyword => 
      normalizedText.includes(keyword)
    );

    if (matchedKeywords.length > 0) {
      return {
        shouldForward: true,
        matchedKeywords,
        reason: `Matched keywords: ${matchedKeywords.join(', ')}`
      };
    }

    return {
      shouldForward: false,
      matchedKeywords: [],
      reason: 'No keywords matched'
    };
  }

  /**
   * Форматирует сообщение для пересылки с дополнительной информацией
   */
  formatForwardMessage(
    originalMessage: string,
    chatTitle: string,
    chatId: string,
    userName: string | null,
    username: string | null,
    matchedKeywords: string[],
    messageDate: Date
  ): string {
    const dateString = messageDate.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let forwardedMessage = `🔍 KEYWORD MATCH DETECTED\n\n`;
    
    forwardedMessage += `📝 Original message:\n${originalMessage}\n\n`;
    
    forwardedMessage += `📊 Message info:\n`;
    forwardedMessage += `💬 Chat: ${chatTitle}\n`;
    forwardedMessage += `🆔 Chat ID: ${chatId}\n`;
    forwardedMessage += `👤 User: ${userName || 'Unknown'}\n`;
    
    // Добавляем username если есть
    if (username) {
      forwardedMessage += `📋 Username: ${username}\n`;
    }
    
    forwardedMessage += `⏰ Time: ${dateString}\n`;
    forwardedMessage += `🎯 Keywords: ${matchedKeywords.join(', ')}\n`;

    return forwardedMessage;
  }

  /**
   * Логирует результат фильтрации
   */
  logFilterResult(
    chatTitle: string,
    messagePreview: string,
    result: FilterResult
  ): void {
    const preview = messagePreview.length > 50 
      ? messagePreview.substring(0, 50) + '...' 
      : messagePreview;

    if (result.shouldForward) {
      this.logger.log(`✅ [${chatTitle}] MATCH: "${preview}" -> Keywords: ${result.matchedKeywords.join(', ')}`);
    } else {
      this.logger.debug(`⏭️ [${chatTitle}] SKIP: "${preview}" -> ${result.reason}`);
    }
  }
}
