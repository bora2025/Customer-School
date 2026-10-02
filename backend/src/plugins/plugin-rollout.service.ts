import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getProcessRole } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

export type ArtifactGeneration = { id: string; pluginId: string; generation: number; version: string; sha256: string; installedPath: string; manifestJson: string; status: string; requiredRolesJson: string };

@Injectable()
export class PluginRolloutService {
  constructor(private readonly prisma: PrismaService) {}

  async stage(tx: Prisma.TransactionClient, plugin: { id: string; version: string; packageSha256: string; installedPath: string; manifestJson: string }) {
    const rows = await tx.$queryRawUnsafe<Array<{ generation: number }>>('SELECT COALESCE(MAX(generation),0)::int + 1 AS generation FROM "PluginArtifactGeneration" WHERE "pluginId"=$1', plugin.id);
    const generation = rows[0]?.generation || 1; const requiredRoles = this.requiredRoles();
    const created = await tx.$queryRawUnsafe<ArtifactGeneration[]>('INSERT INTO "PluginArtifactGeneration" ("pluginId",generation,version,sha256,"installedPath","manifestJson",status,"requiredRolesJson") VALUES ($1,$2,$3,$4,$5,$6,\'staging\',$7) RETURNING *', plugin.id, generation, plugin.version, plugin.packageSha256, plugin.installedPath, plugin.manifestJson, JSON.stringify(requiredRoles));
    return created[0];
  }

  async pendingForCurrentRole() {
    const role = this.role();
    return this.prisma.$queryRawUnsafe<ArtifactGeneration[]>('SELECT * FROM "PluginArtifactGeneration" WHERE status=\'staging\' AND "requiredRolesJson"::jsonb ? $1 ORDER BY "createdAt"', role);
  }

  async report(generation: ArtifactGeneration, sha256: string, error?: string) {
    if (sha256 !== generation.sha256) throw new Error('Runtime readiness digest does not match rollout generation');
    await this.prisma.$executeRawUnsafe('INSERT INTO "PluginArtifactReadiness" ("generationId",role,sha256,ready,error) VALUES ($1::uuid,$2,$3,$4,$5) ON CONFLICT ("generationId",role) DO UPDATE SET sha256=EXCLUDED.sha256,ready=EXCLUDED.ready,error=EXCLUDED.error,"checkedAt"=NOW()', generation.id, this.role(), sha256, !error, error || null);
    return this.promoteIfReady(generation.id);
  }

  async promoteIfReady(generationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<ArtifactGeneration[]>('SELECT * FROM "PluginArtifactGeneration" WHERE id=$1::uuid FOR UPDATE', generationId);
      const generation = rows[0]; if (!generation || generation.status !== 'staging') return generation || null;
      const required: string[] = JSON.parse(generation.requiredRolesJson);
      const ready = await tx.$queryRawUnsafe<Array<{ role: string; sha256: string; ready: boolean }>>('SELECT role,sha256,ready FROM "PluginArtifactReadiness" WHERE "generationId"=$1::uuid', generation.id);
      if (!required.every((role) => ready.some((item) => item.role === role && item.ready && item.sha256 === generation.sha256))) return generation;
      await tx.$executeRawUnsafe('UPDATE "PluginArtifactGeneration" SET status=\'previous\' WHERE "pluginId"=$1 AND status=\'active\'', generation.pluginId);
      await tx.$executeRawUnsafe('UPDATE "PluginArtifactGeneration" SET status=\'active\', "activatedAt"=NOW() WHERE id=$1::uuid', generation.id);
      await tx.pluginInstallation.update({ where: { id: generation.pluginId }, data: { status: 'active', activatedAt: new Date(), lastError: null } });
      return { ...generation, status: 'active' };
    });
  }

  async previous(pluginId: string) {
    const rows = await this.prisma.$queryRawUnsafe<ArtifactGeneration[]>('SELECT * FROM "PluginArtifactGeneration" WHERE "pluginId"=$1 AND status=\'previous\' ORDER BY generation DESC LIMIT 1', pluginId);
    return rows[0] || null;
  }

  async reactivatePrevious(pluginId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<ArtifactGeneration[]>('SELECT * FROM "PluginArtifactGeneration" WHERE "pluginId"=$1 AND status=\'previous\' ORDER BY generation DESC LIMIT 1 FOR UPDATE', pluginId);
      const previous = rows[0]; if (!previous) throw new Error(`No healthy rollback generation exists for ${pluginId}`);
      await tx.$executeRawUnsafe('UPDATE "PluginArtifactGeneration" SET status=\'rolled_back\' WHERE "pluginId"=$1 AND status=\'active\'', pluginId);
      await tx.$executeRawUnsafe('UPDATE "PluginArtifactGeneration" SET status=\'active\', "activatedAt"=NOW() WHERE id=$1::uuid', previous.id);
      return tx.pluginInstallation.update({ where: { id: pluginId }, data: { version: previous.version, packageSha256: previous.sha256, installedPath: previous.installedPath, manifestJson: previous.manifestJson, status: 'active', activatedAt: new Date(), lastError: null } });
    });
  }

  private requiredRoles() {
    const configured = process.env.PLUGIN_REQUIRED_RUNTIME_ROLES?.split(',').map((value) => value.trim()).filter(Boolean);
    if (configured?.length) return [...new Set(configured)];
    return getProcessRole() === 'combined' ? ['combined'] : ['api', 'worker'];
  }
  private role() { return getProcessRole(); }
}
