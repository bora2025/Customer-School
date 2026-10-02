import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { readWorkerStartupConfig } from './config/startup-config';
import { readUpdateRepositoryConfig } from './updates/update-config';
import { readNotificationProviderConfig } from './notification/notification-config';
import { createServer } from 'node:http';
import { PrismaService } from './database/prisma.service';

async function bootstrap() {
  const config = readWorkerStartupConfig();
  readUpdateRepositoryConfig();
  readNotificationProviderConfig();
  const app = await NestFactory.createApplicationContext(AppModule.register(config.distribution), {
    logger: config.nodeEnv === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const server = createServer(async (request, response) => {
    if (request.url === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ status: 'ok', role: 'worker' }));
    }
    if (request.url === '/health/ready') {
      try {
        await prisma.$queryRaw`SELECT 1`;
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ status: 'ready', role: 'worker' }));
      } catch {
        response.writeHead(503, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ status: 'not_ready', role: 'worker' }));
      }
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.workerPort, '0.0.0.0', resolve);
  });
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`Background worker received ${signal}; draining`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  console.log(`Background worker started on health port ${config.workerPort} (${config.distribution} distribution)`);
}

bootstrap().catch((error) => {
  console.error('Worker startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
