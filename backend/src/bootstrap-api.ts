import { Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: config.nodeEnv === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });

  // Without this, req.ip is the gateway's address, so every user shares one rate-limit bucket.
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(cookieParser());
  // Browser CSP reports use their own media types; parse them on that route only, with a small cap.
  app.use('/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }));
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
  // '::' accepts IPv4 and IPv6; Railway's private network routes over IPv6.
  await app.listen(config.port, '::');
  console.log(`API server running on port ${config.port} (${config.processRole} role, ${config.distribution} distribution)`);
}

