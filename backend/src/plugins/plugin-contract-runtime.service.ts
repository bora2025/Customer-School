import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { runsBackgroundJobs } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

type Consumer = { pluginId: string; id: string; event: string; versions: Set<number>; handler(event: DurableEvent): Promise<void> };
export type DurableEvent = { id: string; pluginId: string; eventName: string; schemaVersion: number; subjectKey: string; payload: unknown; createdAt: Date };

@Injectable()
export class PluginContractRuntimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PluginContractRuntimeService.name);
  private readonly consumers = new Map<string, Consumer>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!runsBackgroundJobs()) return;
    this.timer = setInterval(() => void this.dispatch().catch((error) => this.logger.error(error)), Number(process.env.PLUGIN_OUTBOX_POLL_MS || 1000));
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  subscribe(pluginId: string, definition: { id: string; event: string; versions: number[]; handler(event: DurableEvent): void | Promise<void> }) {
    if (!this.safe(pluginId) || !this.safe(definition.id) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9.-]+$/.test(definition.event) || !definition.versions.length || definition.versions.some((v) => !Number.isInteger(v) || v < 1)) throw new Error('Durable event consumer definition is invalid');
    const key = `${pluginId}:${definition.id}`;
    if (this.consumers.has(key)) throw new Error('Durable event consumer is already registered');
    this.consumers.set(key, { pluginId, id: definition.id, event: definition.event, versions: new Set(definition.versions), handler: async (event) => definition.handler(event) });
    return () => this.consumers.delete(key);
  }

  async publish(tx: Prisma.TransactionClient, pluginId: string, input: { event: string; version: number; subjectKey: string; payload: unknown; idempotencyKey: string }) {
    if (!this.safe(pluginId) || !input.event.startsWith(`${pluginId}.`) || !Number.isInteger(input.version) || input.version < 1 || !input.subjectKey || input.subjectKey.length > 200 || !/^[a-zA-Z0-9._:-]{1,200}$/.test(input.idempotencyKey)) throw new Error('Durable event is invalid');
    const payloadJson = JSON.stringify(input.payload);
    if (Buffer.byteLength(payloadJson) > Number(process.env.PLUGIN_EVENT_MAX_BYTES || 64 * 1024)) throw new Error('Durable event payload exceeds its quota');
    await tx.$executeRawUnsafe(
      'INSERT INTO "PluginOutboxEvent" ("pluginId","eventName","schemaVersion","subjectKey","payloadJson","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("pluginId","idempotencyKey") DO NOTHING',
      pluginId, input.event, input.version, input.subjectKey, payloadJson, input.idempotencyKey,
    );
  }

  async dispatch(limit = 50) {
    const rows = await this.prisma.$transaction(async (tx) => tx.$queryRawUnsafe<any[]>(
      `WITH claimed AS (
         SELECT id FROM "PluginOutboxEvent"
         WHERE status IN ('pending','processing') AND "availableAt" <= NOW()
         ORDER BY "subjectKey", "createdAt" FOR UPDATE SKIP LOCKED LIMIT $1
       ) UPDATE "PluginOutboxEvent" event SET status='processing', "availableAt"=NOW() + INTERVAL '5 minutes'
         FROM claimed WHERE event.id=claimed.id RETURNING event.*`, limit,
    ));
    for (const row of rows) await this.deliver(row);
    return rows.length;
  }

  private async deliver(row: any) {
    const interested = [...this.consumers.values()].filter((consumer) => consumer.event === row.eventName && consumer.versions.has(row.schemaVersion));
    try {
      for (const consumer of interested) {
        await this.prisma.$transaction(async (tx) => {
          const inserted = await tx.$executeRawUnsafe('INSERT INTO "PluginProcessedEvent" ("eventId","consumerPluginId","consumerId") VALUES ($1::uuid,$2,$3) ON CONFLICT DO NOTHING', row.id, consumer.pluginId, consumer.id);
          if (!inserted) return;
          await consumer.handler({ id: row.id, pluginId: row.pluginId, eventName: row.eventName, schemaVersion: row.schemaVersion, subjectKey: row.subjectKey, payload: JSON.parse(row.payloadJson), createdAt: row.createdAt });
        });
      }
      await this.prisma.$executeRawUnsafe(`UPDATE "PluginOutboxEvent" SET status = 'delivered', "deliveredAt" = NOW(), "lastError" = NULL WHERE id = $1::uuid`, row.id);
    } catch (error) {
      const attempts = Number(row.attempts) + 1; const message = error instanceof Error ? error.message : String(error);
      const maximum = Number(process.env.PLUGIN_EVENT_MAX_ATTEMPTS || 8);
      if (attempts >= maximum) {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`UPDATE "PluginOutboxEvent" SET status = 'dead', attempts = $2, "lastError" = $3 WHERE id = $1::uuid`, row.id, attempts, message);
          for (const consumer of interested) await tx.$executeRawUnsafe('INSERT INTO "PluginDeadLetter" ("eventId","consumerPluginId","consumerId",error) VALUES ($1::uuid,$2,$3,$4)', row.id, consumer.pluginId, consumer.id, message);
        });
      } else {
        const delay = Math.min(3600, 2 ** attempts);
        await this.prisma.$executeRawUnsafe(`UPDATE "PluginOutboxEvent" SET status='pending', attempts = $2, "lastError" = $3, "availableAt" = NOW() + ($4 * INTERVAL '1 second') WHERE id = $1::uuid`, row.id, attempts, message, delay);
      }
    }
  }

  async putReadModel(pluginId: string, model: string, version: number, recordKey: string, data: unknown) {
    if (!this.safe(pluginId) || !this.safe(model) || !recordKey || !Number.isInteger(version) || version < 1) throw new Error('Plugin read model is invalid');
    const dataJson = JSON.stringify(data);
    if (Buffer.byteLength(dataJson) > Number(process.env.PLUGIN_READ_MODEL_MAX_BYTES || 256 * 1024)) throw new Error('Plugin read model exceeds its quota');
    await this.prisma.$executeRawUnsafe('INSERT INTO "PluginReadModel" ("ownerPluginId","modelName","schemaVersion","recordKey","dataJson") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("ownerPluginId","modelName","recordKey") DO UPDATE SET "schemaVersion"=EXCLUDED."schemaVersion", "dataJson"=EXCLUDED."dataJson", "updatedAt"=NOW()', pluginId, model, version, recordKey, dataJson);
  }
  async readModel(ownerPluginId: string, model: string, acceptedVersions: number[], recordKey?: string | string[]) {
    const keys = Array.isArray(recordKey) ? [...new Set(recordKey)] : null;
    if (!this.safe(ownerPluginId) || !this.safe(model) || !acceptedVersions.length
      || (typeof recordKey === 'string' && (!recordKey || recordKey.length > 200))
      || (keys && (!keys.length || keys.length > 500 || keys.some((key) => typeof key !== 'string' || !key || key.length > 200)))) throw new Error('Plugin read model request is invalid');
    const rows = recordKey === undefined
      ? await this.prisma.$queryRawUnsafe<any[]>('SELECT "recordKey","schemaVersion","dataJson","updatedAt" FROM "PluginReadModel" WHERE "ownerPluginId"=$1 AND "modelName"=$2 AND "schemaVersion" = ANY($3::int[]) ORDER BY "recordKey" LIMIT 10000', ownerPluginId, model, acceptedVersions)
      : keys
        ? await this.prisma.$queryRawUnsafe<any[]>('SELECT "recordKey","schemaVersion","dataJson","updatedAt" FROM "PluginReadModel" WHERE "ownerPluginId"=$1 AND "modelName"=$2 AND "schemaVersion" = ANY($3::int[]) AND "recordKey" = ANY($4::text[]) ORDER BY "recordKey" LIMIT 500', ownerPluginId, model, acceptedVersions, keys)
        : await this.prisma.$queryRawUnsafe<any[]>('SELECT "recordKey","schemaVersion","dataJson","updatedAt" FROM "PluginReadModel" WHERE "ownerPluginId"=$1 AND "modelName"=$2 AND "schemaVersion" = ANY($3::int[]) AND "recordKey"=$4 LIMIT 1', ownerPluginId, model, acceptedVersions, recordKey);
    return rows.map((row) => ({ key: row.recordKey, version: row.schemaVersion, data: JSON.parse(row.dataJson), updatedAt: row.updatedAt }));
  }
  async health(pluginId: string) {
    if (!this.safe(pluginId)) throw new Error('Plugin id is invalid');
    const dead = await this.prisma.$queryRawUnsafe<Array<{ id: string; eventId: string; consumerId: string; error: string; failedAt: Date }>>('SELECT id,"eventId","consumerId",error,"failedAt" FROM "PluginDeadLetter" WHERE "consumerPluginId"=$1 AND "replayedAt" IS NULL ORDER BY "failedAt" DESC LIMIT 100', pluginId);
    return { status: dead.length ? 'degraded' : 'healthy', deadLetterCount: dead.length, deadLetters: dead };
  }
  async replay(pluginId: string, deadLetterId: string) {
    if (!this.safe(pluginId) || !/^[a-f0-9-]{36}$/i.test(deadLetterId)) throw new Error('Dead-letter replay request is invalid');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ eventId: string }>>('SELECT "eventId" FROM "PluginDeadLetter" WHERE id=$1::uuid AND "consumerPluginId"=$2 AND "replayedAt" IS NULL FOR UPDATE', deadLetterId, pluginId);
      if (!rows[0]) throw new Error('Dead letter was not found');
      await tx.$executeRawUnsafe('DELETE FROM "PluginProcessedEvent" WHERE "eventId"=$1::uuid AND "consumerPluginId"=$2', rows[0].eventId, pluginId);
      await tx.$executeRawUnsafe('UPDATE "PluginOutboxEvent" SET status=\'pending\',attempts=0,"availableAt"=NOW(),"lastError"=NULL WHERE id=$1::uuid', rows[0].eventId);
      await tx.$executeRawUnsafe('UPDATE "PluginDeadLetter" SET "replayedAt"=NOW() WHERE id=$1::uuid', deadLetterId);
      return { id: deadLetterId, status: 'requeued' };
    });
  }
  clear(pluginId: string) { for (const [key, consumer] of this.consumers) if (consumer.pluginId === pluginId) this.consumers.delete(key); }
  private safe(value: string) { return /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value); }
}
