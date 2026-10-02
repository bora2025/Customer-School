import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getDistribution } from '../config/environment';
import { assertCompatibleSchemaLineage } from './schema-lineage';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Only log errors and slow queries (saves CPU on verbose logging)
      log: process.env.NODE_ENV === 'production'
        ? [{ level: 'error', emit: 'stdout' }]
        : [
            { level: 'error', emit: 'stdout' },
            { level: 'warn', emit: 'stdout' },
          ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    if (getDistribution() === 'core') {
      await assertCompatibleSchemaLineage(this, 'core');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
