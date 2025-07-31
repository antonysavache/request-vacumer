import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { ChatPollingService } from './chat-polling.service';
import { MessageFilterService } from './message-filter.service';

@Module({
  imports: [TelegramModule],
  providers: [ChatPollingService, MessageFilterService],
  exports: [ChatPollingService, MessageFilterService],
})
export class MonitoringModule {}
