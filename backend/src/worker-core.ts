import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { AppCoreModule } from './app-core.module';
import { readWorkerStartupConfig } from './config/startup-config';
import { getDistribution } from './config/environment';
import { PrismaService } from './database/prisma.service';
import { readNotificationProviderConfig } from './notification/notification-config';
import { readUpdateRepositoryConfig } from './updates/update-config';

if (getDistribution() !== 'core') {
  throw new Error('The physical lean-core worker artifact requires WATTANAM_DISTRIBUTION=core');
}

async function bootstrap() {
  const config = readWorkerStartupConfig();
  readUpdateRepositoryConfig();
  readNotificationProviderConfig();
  const app = await NestFactory.createApplicationContext(AppCoreModule.register(), {
    logger: config.nodeEnv === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const server = createServer(async (request, response) => {
    if (request.url === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ status: 'ok', role: 'worker', distribution: 'core' }));
    }
    if (request.url === '/health/ready') {
      try {
        await prisma.$queryRaw`SELECT 1`;
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ status: 'ready', role: 'worker', distribution: 'core' }));
      } catch {
        response.writeHead(503, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ status: 'not_ready', role: 'worker', distribution: 'core' }));
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
    console.log(`Core background worker received ${signal}; draining`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  console.log(`Core background worker started on health port ${config.workerPort}`);
}

bootstrap().catch((error) => {
  console.error('Core worker startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
