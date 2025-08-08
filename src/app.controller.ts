import { Controller, Get, Post, Query, Body } from '@nestjs/common';
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

  @Post('send-private-message')
  async sendPrivateMessage(
    @Body() body: { 
      userId: string; 
      message: string;
      parseMode?: 'markdown' | 'html';
    }
  ) {
    return this.appService.sendPrivateMessage(body.userId, body.message, body.parseMode);
  }

  @Get('debug/private-dialogs')
  async debugPrivateDialogs() {
    return this.appService.debugPrivateDialogs();
  }
}
