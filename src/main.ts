import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    logger.log('🚀 Starting Request Vacuumer application...');
    
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn', 'debug'],
    });
    
    // Включаем CORS для фронтенда
    app.enableCors({
      origin: [
        'http://localhost:4200',
        'http://localhost:3000', 
        'https://your-frontend-domain.com'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    
    const port = process.env.PORT ?? 3005; // Поменял порт на 3005
    await app.listen(port);
    
    logger.log(`✅ Application is running on: http://localhost:${port}`);
    logger.log('📱 Telegram client initialization started automatically...');
    
  } catch (error) {
    logger.error('❌ Failed to start application:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

// Обработка неожиданных ошибок
process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('UnhandledRejection');
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  const logger = new Logger('UncaughtException');
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

bootstrap();
