export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString?: string;
}

export const getTelegramConfig = (): TelegramConfig => {
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER;
  const sessionString = process.env.TELEGRAM_SESSION_STRING;

  if (!apiId || !apiHash || !phoneNumber) {
    throw new Error('Missing required Telegram configuration. Please set TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_PHONE_NUMBER in environment variables.');
  }

  return {
    apiId: parseInt(apiId, 10),
    apiHash,
    phoneNumber,
    sessionString: sessionString || undefined,
  };
};
