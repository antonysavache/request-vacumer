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
    @Query('chat_id') chatId?: string,
  ) {
    return this.appService.getChatHistory({
      fromDate,
      toDate,
      hoursBack: hoursBack ? parseInt(hoursBack) : undefined,
      chatId,
    });
  }

  @Get('available-chats')
  async getAvailableChats() {
    return this.appService.getAvailableChats();
  }

  @Get('chat-info')
  async getChatInfo(@Query('chat_id') chatId: string) {
    if (!chatId) {
      return {
        success: false,
        error: 'chat_id parameter is required'
      };
    }
    return this.appService.getChatInfo(chatId);
  }

  @Get('chat-stats')
  async getChatStats(@Query('chat_id') chatId: string) {
    if (!chatId) {
      return {
        success: false,
        error: 'chat_id parameter is required'
      };
    }
    return this.appService.getChatStats(chatId);
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
