import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import semver from 'semver';
import { readRuntimeConfig } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { PluginsService } from '../plugins/plugins.service';
import { BackupService } from '../backup/backup.service';
import { maintenanceFlagPath, updateStateDirectory } from './maintenance-mode.middleware';
import { readUpdateRepositoryConfig } from './update-config';
import { verifyRepositoryEnvelope } from './repository-signature';
import { pluginInstallConsentDigest, pluginInstallDisclosure } from '../marketplace/plugin-install-consent';
import { PluginEntitlementPolicyService } from '../plugins/plugin-entitlement-policy.service';

@Injectable()
export class UpdatesService {
  constructor(private readonly prisma: PrismaService, private readonly plugins: PluginsService, private readonly backup: BackupService, private readonly entitlements: PluginEntitlementPolicyService) {}

  async check() {
    const config = readUpdateRepositoryConfig();
    if (!config) return { enabled: false, reason: 'MARKETPLACE_URL is not configured' };
    const coreVersion = readRuntimeConfig().appVersion;
    if (!semver.valid(coreVersion)) throw new ServiceUnavailableException('APP_VERSION must be semantic versioning before update checks can run');
    const payload = await this.index(config, coreVersion);
    const installed = await this.prisma.pluginInstallation.findMany();
    const pluginUpdates = installed.flatMap((plugin) => {
      const releases = payload.pluginReleases.filter((release: any) => release.pluginId === plugin.id && semver.valid(release.version) && semver.gt(release.version, plugin.version));
      const newest = releases.sort((a: any, b: any) => semver.rcompare(a.version, b.version))[0];
      return newest ? [{ pluginId: plugin.id, installedVersion: plugin.version, status: plugin.status, release: this.publicRelease(newest) }] : [];
    });
    const advisories = payload.advisories.filter((advisory: any) => {
      const plugin = installed.find((candidate) => candidate.id === advisory.pluginId);
      return plugin && semver.valid(plugin.version) && semver.validRange(advisory.affectedVersions) && semver.satisfies(plugin.version, advisory.affectedVersions);
    });
    const coreUpdates = payload.coreReleases
      .filter((release: any) => semver.valid(release.version) && semver.gt(release.version, coreVersion))
      .map((release: any) => {
        const blockers = installed.filter((plugin) => {
          if (plugin.status !== 'active') return false;
          try {
            const manifest = JSON.parse(plugin.manifestJson);
            return !semver.validRange(manifest.requiresCore) || !semver.satisfies(release.version, manifest.requiresCore);
          } catch { return true; }
        }).map((plugin) => plugin.id);
        return { ...release, blockedByActivePlugins: blockers };
      });
    return {
      enabled: true, repository: new URL(config.url).host, checkedAt: new Date().toISOString(),
      core: { installedVersion: coreVersion, updates: coreUpdates }, pluginUpdates, advisories,
    };
  }

  async installPlugin(pluginId: string, version: string, consentDigest: string) {
    await this.entitlements.assertCanUpdate(pluginId);
    const config = readUpdateRepositoryConfig();
    if (!config) throw new ServiceUnavailableException('Update repository is not configured');
    if (!semver.valid(version)) throw new BadRequestException('version must be semantic versioning');
    const coreVersion = readRuntimeConfig().appVersion;
    const payload = await this.index(config, coreVersion);
    const release = payload.pluginReleases.find((candidate: any) => candidate.pluginId === pluginId && candidate.version === version);
    if (!release) throw new NotFoundException('Compatible repository release not found');
    if (!/^[a-f0-9]{64}$/.test(consentDigest) || consentDigest !== pluginInstallConsentDigest(release.manifest)) {
      throw new BadRequestException('Plugin update capabilities changed or were not approved; review the update disclosure again');
    }
    const download = new URL(release.downloadUrl);
    if (download.origin !== config.url || !download.pathname.startsWith('/v1/artifacts/')) throw new BadGatewayException('Repository returned an untrusted artifact URL');
    if (!/^[a-f0-9]{64}$/.test(release.sha256)) throw new BadGatewayException('Repository returned an invalid artifact checksum');
    const response = await this.fetchWithTimeout(download, config.artifactTimeoutMs);
    if (!response.ok) throw new BadGatewayException(`Artifact download failed (${response.status})`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > config.maximumArtifactBytes) throw new BadGatewayException('Artifact exceeds the configured size limit');
    if (!response.body) throw new BadGatewayException('Artifact response has no body');
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of response.body as any) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      if (received > config.maximumArtifactBytes) throw new BadGatewayException('Artifact exceeds the configured size limit');
      chunks.push(bytes);
    }
    const buffer = Buffer.concat(chunks);
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== release.sha256) throw new BadGatewayException('Downloaded artifact checksum does not match signed metadata');
    return this.plugins.install(buffer);
  }

  async prepareCoreUpdate(version: string) {
    if (!semver.valid(version)) throw new BadRequestException('version must be semantic versioning');
    const config = readUpdateRepositoryConfig();
    if (!config) throw new ServiceUnavailableException('Update repository is not configured');
    const currentVersion = readRuntimeConfig().appVersion;
    if (!semver.valid(currentVersion) || !semver.gt(version, currentVersion)) throw new BadRequestException('Target must be newer than the installed core version');
    const payload = await this.index(config, currentVersion);
    const release = payload.coreReleases.find((candidate: any) => candidate.version === version);
    if (!release) throw new NotFoundException('Compatible core release not found');
    const installed = await this.prisma.pluginInstallation.findMany();
    const blockers = this.coreBlockers(installed, version);
    if (blockers.length) throw new ConflictException({ message: 'Active plugins block this core update', blockers });
    const backup = await this.backup.create();
    const operation = {
      schemaVersion: 1, id: randomUUID(), state: 'prepared', fromVersion: currentVersion, toVersion: version,
      preparedAt: new Date().toISOString(), release, backup: { file: backup.file, sha256: backup.sha256, createdAt: backup.createdAt },
      recovery: { procedure: 'docs/operations/core-update-and-recovery.md', restoreArchive: backup.file },
    };
    await fs.mkdir(updateStateDirectory(), { recursive: true });
    await this.writeJsonAtomic(path.join(updateStateDirectory(), `${operation.id}.json`), operation);
    await this.writeJsonAtomic(maintenanceFlagPath(), { operationId: operation.id, enteredAt: operation.preparedAt, targetVersion: version });
    return operation;
  }

  async completeCoreUpdate(operationId: string, input: { outcome?: unknown; detail?: unknown }) {
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new BadRequestException('Invalid update operation id');
    if (!['healthy', 'failed'].includes(String(input.outcome))) throw new BadRequestException('outcome must be healthy or failed');
    const file = path.join(updateStateDirectory(), `${operationId}.json`);
    let operation: any;
    try { operation = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new NotFoundException('Update operation not found'); }
    if (operation.state !== 'prepared') throw new ConflictException('Update operation is already terminal');
    operation.state = input.outcome === 'healthy' ? 'completed' : 'recovery_required';
    operation.completedAt = new Date().toISOString();
    operation.detail = typeof input.detail === 'string' ? input.detail.slice(0, 2000) : null;
    await this.writeJsonAtomic(file, operation);
    if (operation.state === 'completed') await fs.unlink(maintenanceFlagPath()).catch((error: any) => { if (error?.code !== 'ENOENT') throw error; });
    return operation;
  }

  async maintenanceStatus() {
    try { return { active: true, ...JSON.parse(await fs.readFile(maintenanceFlagPath(), 'utf8')) }; }
    catch (error: any) { if (error?.code === 'ENOENT') return { active: false }; throw error; }
  }

  async applyEmergencyAdvisories() {
    const config = readUpdateRepositoryConfig();
    if (!config) throw new ServiceUnavailableException('Update repository is not configured');
    const coreVersion = readRuntimeConfig().appVersion;
    const payload = await this.index(config, coreVersion);
    const installed = await this.prisma.pluginInstallation.findMany();
    const applied: Array<{ pluginId: string; advisoryId: string; action: string }> = [];
    for (const advisory of payload.advisories) {
      if (!['disable', 'remove'].includes(advisory.recommendedAction)) continue;
      const plugin = installed.find((candidate) => candidate.id === advisory.pluginId && candidate.status === 'active');
      if (!plugin || !semver.valid(plugin.version) || !semver.validRange(advisory.affectedVersions) || !semver.satisfies(plugin.version, advisory.affectedVersions)) continue;
      await this.plugins.deactivate(plugin.id);
      applied.push({ pluginId: plugin.id, advisoryId: advisory.id, action: 'deactivated' });
    }
    return { applied, destructiveRemovalPerformed: false };
  }

  /** Public so other services (e.g. the marketplace commerce install action) can reuse the same
   * signature-verified, replay/downgrade-protected fetch instead of re-implementing it. */
  async index(config: NonNullable<ReturnType<typeof readUpdateRepositoryConfig>>, coreVersion: string) {
    const url = new URL('/v1/index', config.url);
    url.searchParams.set('coreVersion', coreVersion);
    url.searchParams.set('channel', config.channel);
    const response = await this.fetchWithTimeout(url, config.indexTimeoutMs);
    if (!response.ok) throw new BadGatewayException(`Update repository check failed (${response.status})`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new BadGatewayException('Update repository returned invalid JSON'); }
    try {
      const payload = verifyRepositoryEnvelope(body, config.publicKeys);
      await this.enforceRepositoryWatermark(payload.generatedAt);
      return payload;
    }
    catch (error) { throw new BadGatewayException(error instanceof Error ? error.message : 'Repository signature validation failed'); }
  }

  private coreBlockers(installed: any[], targetVersion: string) {
    return installed.filter((plugin) => {
      if (plugin.status !== 'active') return false;
      try {
        const manifest = JSON.parse(plugin.manifestJson);
        return !semver.validRange(manifest.requiresCore) || !semver.satisfies(targetVersion, manifest.requiresCore);
      } catch { return true; }
    }).map((plugin) => plugin.id);
  }

  private async writeJsonAtomic(target: string, value: unknown) {
    const temporary = `${target}.${process.pid}.${Date.now()}.partial`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  }

  private async enforceRepositoryWatermark(generatedAt: unknown) {
    if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) throw new Error('Repository metadata generatedAt is invalid');
    const timestamp = Date.parse(generatedAt);
    if (timestamp > Date.now() + 5 * 60_000) throw new Error('Repository metadata is dated too far in the future');
    const directory = updateStateDirectory();
    const file = path.join(directory, 'repository-watermark.json');
    await fs.mkdir(directory, { recursive: true });
    let previous = 0;
    try { previous = Date.parse(JSON.parse(await fs.readFile(file, 'utf8')).generatedAt) || 0; }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    if (timestamp < previous) throw new Error('Repository metadata replay or downgrade detected');
    if (timestamp > previous) await this.writeJsonAtomic(file, { generatedAt: new Date(timestamp).toISOString() });
  }

  private async fetchWithTimeout(url: URL, milliseconds: number) {
    try { return await fetch(url, { signal: AbortSignal.timeout(milliseconds), redirect: 'error', headers: { Accept: 'application/json, application/vnd.wattanam.plugin+zip' } }); }
    catch { throw new BadGatewayException('Update repository is unavailable'); }
  }

  private publicRelease(release: any) {
    const disclosure = pluginInstallDisclosure(release.manifest);
    return {
      pluginId: release.pluginId, name: release.name, version: release.version, publisher: release.publisher,
      requiresCore: release.requiresCore, channel: release.channel, paid: release.paid,
      changelog: release.changelog, sha256: release.sha256, sizeBytes: release.sizeBytes,
      ...disclosure, consentDigest: pluginInstallConsentDigest(release.manifest),
    };
  }
}
