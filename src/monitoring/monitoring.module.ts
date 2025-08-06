import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { ChatPollingService } from './chat-polling.service';
import { MessageFilterService } from './message-filter.service';
import { DelayedMessageService } from './delayed-message.service';

@Module({
  imports: [TelegramModule],
  providers: [ChatPollingService, MessageFilterService, DelayedMessageService],
  exports: [ChatPollingService, MessageFilterService, DelayedMessageService],
})
export class MonitoringModule {}
