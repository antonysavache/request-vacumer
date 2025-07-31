import { Module } from '@nestjs/common';
import { TelegramClientService } from './telegram-client.service';
import { TelegramSessionService } from './telegram-session.service';
import { TelegramAuthService } from './telegram-auth.service';

@Module({
  providers: [TelegramClientService, TelegramSessionService, TelegramAuthService],
  exports: [TelegramClientService, TelegramSessionService, TelegramAuthService],
})
export class TelegramModule {}
