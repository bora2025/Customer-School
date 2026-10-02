import { Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { DynamicModule } from '@nestjs/common';
import { readApiStartupConfig } from './config/startup-config';
import { readNotificationProviderConfig } from './notification/notification-config';
import { readUpdateRepositoryConfig } from './updates/update-config';

export async function bootstrapApi(rootModule: Type<unknown> | DynamicModule) {
  const config = readApiStartupConfig();
  readUpdateRepositoryConfig();
  readNotificationProviderConfig();
  const app = await NestFactory.create(rootModule, {
    logger: config.nodeEnv === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });

  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());
  app.use((_request, response, next) => {
    response.setHeader('X-Wattanam-API-Version', '1');
    next();
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const allowedOrigins = config.corsOrigins.length
    ? config.corsOrigins
    : ['http://localhost:3000', 'http://localhost:3004'];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });
  app.enableShutdownHooks(undefined, { useProcessExit: true });
  await app.listen(config.port, '0.0.0.0');
  console.log(`API server running on port ${config.port} (${config.processRole} role, ${config.distribution} distribution)`);
}

