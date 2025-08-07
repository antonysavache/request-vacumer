import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('chat-history')
  async getChatHistory(
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('hours_back') hoursBack?: string,
  ) {
    return this.appService.getChatHistory({
      fromDate,
      toDate,
      hoursBack: hoursBack ? parseInt(hoursBack) : undefined,
    });
  }
}
