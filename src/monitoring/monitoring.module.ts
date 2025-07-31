import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { ChatMonitorService } from './chat-monitor.service';
import { MessageFilterService } from './message-filter.service';

@Module({
  imports: [TelegramModule],
  providers: [ChatMonitorService, MessageFilterService],
  exports: [ChatMonitorService, MessageFilterService],
})
export class MonitoringModule {}
