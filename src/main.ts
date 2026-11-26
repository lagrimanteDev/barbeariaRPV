import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  app.enableCors({
    origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
    allowedHeaders: ['Content-Type', 'x-empresa-id', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }))

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
