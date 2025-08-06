export interface MonitoringConfig {
  targetChats: string[];
  keywords: string[];
  targetChatId: string;
  excludeKeywords?: string[];
  minMessageLength?: number;
  // Настройки отложенных сообщений
  delayedMessagesEnabled?: boolean;
  defaultDelayMinutes?: number;
  logChatId?: string;
  delayedMessage?: string;
}

export const getMonitoringConfig = (): MonitoringConfig => {
  const targetChatsEnv = process.env.TARGET_CHATS;
  const keywordsEnv = process.env.KEYWORDS;
  const targetChatId = process.env.TARGET_CHAT_ID;
  const excludeKeywordsEnv = process.env.EXCLUDE_KEYWORDS;
  const minMessageLengthEnv = process.env.MIN_MESSAGE_LENGTH;
  const delayedMessagesEnabledEnv = process.env.DELAYED_MESSAGES_ENABLED;
  const defaultDelayMinutesEnv = process.env.DEFAULT_DELAY_MINUTES;
  const logChatIdEnv = process.env.LOG_CHAT_ID;
  const delayedMessageEnv = process.env.DELAYED_MESSAGE;

  if (!targetChatsEnv || !keywordsEnv || !targetChatId) {
    throw new Error('Missing required monitoring configuration. Please set TARGET_CHATS, KEYWORDS, and TARGET_CHAT_ID in environment variables.');
  }

  // Парсим чаты из строки через запятую
  const targetChats = targetChatsEnv
    .split(',')
    .map(chat => chat.trim())
    .filter(chat => chat.length > 0);

  // Парсим ключевые слова из строки через запятую
  const keywords = keywordsEnv
    .split(',')
    .map(keyword => keyword.trim().toLowerCase())
    .filter(keyword => keyword.length > 0);

  // Парсим исключающие ключевые слова (опционально)
  const excludeKeywords = excludeKeywordsEnv
    ? excludeKeywordsEnv
        .split(',')
        .map(keyword => keyword.trim().toLowerCase())
        .filter(keyword => keyword.length > 0)
    : [];

  // Минимальная длина сообщения (опционально)
  const minMessageLength = minMessageLengthEnv 
    ? parseInt(minMessageLengthEnv, 10) 
    : 0;

  // Настройки отложенных сообщений
  const delayedMessagesEnabled = delayedMessagesEnabledEnv === 'true';
  const defaultDelayMinutes = defaultDelayMinutesEnv 
    ? parseInt(defaultDelayMinutesEnv, 10) 
    : 30; // по умолчанию 30 минут

  return {
    targetChats,
    keywords,
    targetChatId: targetChatId.trim(),
    excludeKeywords: excludeKeywords.length > 0 ? excludeKeywords : undefined,
    minMessageLength: minMessageLength > 0 ? minMessageLength : undefined,
    delayedMessagesEnabled,
    defaultDelayMinutes,
    logChatId: logChatIdEnv?.trim(),
    delayedMessage: delayedMessageEnv,
  };
};
