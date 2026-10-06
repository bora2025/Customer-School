import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import semver from 'semver';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { readRuntimeConfig } from '../config/environment';
import { trustedPluginKeys } from './plugin-config';
import { PluginPackageVerifier, TrustedPluginKeys, VerifiedPluginPackage } from './plugin-package';
import { PluginRuntimeService } from './plugin-runtime.service';
import { PluginMigrationsService } from './plugin-migrations.service';
import { PluginArtifactCacheService } from './plugin-artifact-cache.service';
import { PluginRolloutService } from './plugin-rollout.service';
import { PluginContractRuntimeService } from './plugin-contract-runtime.service';
import { PluginEntitlementPolicyService } from './plugin-entitlement-policy.service';

/**
 * Wall-clock ceiling for a single locked lifecycle transaction (install,
 * activate, deactivate, or remove). A plugin migration or filesystem move
 * that hangs past this fails closed instead of holding the plugin's
 * advisory lock — and every later request for the same plugin — forever.
 */
const LIFECYCLE_TRANSACTION_TIMEOUT_MS = 30_000;
const LIFECYCLE_TRANSACTION_MAX_WAIT_MS = 10_000;

@Injectable()
export class PluginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: PluginPackageVerifier,
    private readonly runtime: PluginRuntimeService,
    private readonly migrations: PluginMigrationsService,
    @Optional() private readonly artifactCache?: PluginArtifactCacheService,
    @Optional() private readonly rollout?: PluginRolloutService,
    @Optional() private readonly contracts?: PluginContractRuntimeService,
    @Optional() private readonly entitlements?: PluginEntitlementPolicyService,
  ) {}

  /**
   * Runs `work` inside a transaction that first takes a PostgreSQL
   * transaction-scoped advisory lock keyed by the plugin id. Concurrent
   * install/activate/deactivate/remove calls for the *same* plugin id
   * serialize on this lock; calls for different plugin ids never block each
   * other. The lock is released automatically on commit, rollback, or a
   * dropped connection (crash), so it can never be left stuck.
   */
  private withPluginLock<T>(pluginId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${pluginId}))`);
      return work(tx);
    }, { timeout: LIFECYCLE_TRANSACTION_TIMEOUT_MS, maxWait: LIFECYCLE_TRANSACTION_MAX_WAIT_MS });
  }

  /**
   * A crashed install can leave an extracted `destination` directory on disk
   * with no committed registry row (the process died between `fs.rename`
   * and the transaction that records it). Without this check, retrying the
   * exact same install permanently fails with "already present" even though
   * nothing is actually installed — a stuck state only a manual filesystem
   * fix could clear. If the directory's contents do not correspond to a
   * committed installation of this exact id/version/package, it is treated
   * as a crash orphan and removed so the retry can proceed deterministically.
   */
  private async reconcileOrphanDestination(destination: string, verified: VerifiedPluginPackage) {
    try {
      await fs.access(destination);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const registered = await this.prisma.pluginInstallation.findUnique({ where: { id: verified.manifest.id } });
    const isGenuineDuplicate = registered?.version === verified.manifest.version && registered?.packageSha256 === verified.packageSha256;
    if (isGenuineDuplicate) throw new ConflictException(`Plugin ${verified.manifest.id}@${verified.manifest.version} is already present`);
    await fs.rm(destination, { recursive: true, force: true });
  }

  async list() {
    const plugins = await this.prisma.pluginInstallation.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(plugins.map(async (plugin) => ({
      ...this.publicPlugin(plugin),
      rollbackAvailable: this.rollout ? !!await this.rollout.previous(plugin.id) : false,
      entitlement: this.entitlements ? await this.entitlements.decision(plugin.id) : null,
    })));
  }

  runtimeStatus() { return this.runtime.status(); }
  async diagnostics() {
    const [plugins, jobs] = await Promise.all([
      this.prisma.pluginInstallation.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.pluginJobDefinition.findMany({ orderBy: [{ pluginId: 'asc' }, { jobId: 'asc' }] }),
    ]);
    const runtime = this.runtime.status();
    const loaded = new Set(runtime.loaded);
    const results = await Promise.all(plugins.map(async (plugin) => {
      let artifact: 'present' | 'missing' = 'present';
      try { await fs.access(plugin.installedPath); } catch { artifact = 'missing'; }
      const entitlement = this.entitlements ? await this.entitlements.decision(plugin.id).catch((error) => ({ mode: 'unknown', reason: error instanceof Error ? error.message : String(error) })) : null;
      const contract = this.contracts ? await this.contracts.health(plugin.id).catch((error) => ({ status: 'failed', reason: error instanceof Error ? error.message : String(error) })) : null;
      const pluginJobs = jobs.filter((job) => job.pluginId === plugin.id).map((job) => ({ id: job.jobId, enabled: job.enabled, lastStatus: job.lastStatus, lastError: job.lastError }));
      const problems: string[] = [];
      if (plugin.status === 'failed') problems.push(plugin.lastError || 'Registry status is failed');
      if (artifact === 'missing') problems.push('Installed artifact directory is missing');
      if (plugin.status === 'active' && !loaded.has(plugin.id)) problems.push('Registry is active but runtime is not loaded');
      if (entitlement && entitlement.mode === 'read_only') problems.push(entitlement.reason);
      if (contract && contract.status !== 'healthy') problems.push(`Contract runtime is ${contract.status}`);
      if (pluginJobs.some((job) => job.lastStatus === 'failed')) problems.push('One or more background jobs last failed');
      const failed = artifact === 'missing' || plugin.status === 'failed' || (plugin.status === 'active' && !loaded.has(plugin.id));
      return {
        id: plugin.id, name: plugin.name, version: plugin.version, registryStatus: plugin.status,
        status: failed ? 'failed' : problems.length ? 'degraded' : 'healthy', artifact,
        runtimeLoaded: loaded.has(plugin.id), entitlement, contract, jobs: pluginJobs, problems,
      };
    }));
    return {
      status: results.some((plugin) => plugin.status === 'failed') ? 'failed' : results.some((plugin) => plugin.status === 'degraded') ? 'degraded' : 'healthy',
      safeMode: runtime.safeMode, checkedAt: new Date().toISOString(), plugins: results,
    };
  }
  contractHealth(id: string) { if (!this.contracts) throw new ConflictException('Plugin contract runtime is unavailable'); return this.contracts.health(id); }
  replayDeadLetter(id: string, deadLetterId: string) { if (!this.contracts) throw new ConflictException('Plugin contract runtime is unavailable'); return this.contracts.replay(id, deadLetterId); }

  async inspect(packageBuffer: Buffer) {
    const verified = await this.verifier.verify(packageBuffer, await trustedPluginKeys(), readRuntimeConfig().appVersion);
    await this.assertDependencies(verified);
    return {
      packageSha256: verified.packageSha256,
      plugin: {
        id: verified.manifest.id, name: verified.manifest.name, description: verified.manifest.description,
        version: verified.manifest.version, publisher: verified.manifest.publisher, requiresCore: verified.manifest.requiresCore,
        capabilities: verified.manifest.capabilities, permissions: verified.manifest.permissions,
        dependencies: verified.manifest.dependencies, migrations: verified.manifest.migrations.map(({ id, destructive }) => ({ id, destructive })),
        navigation: verified.manifest.navigation, supportUrl: verified.manifest.supportUrl, privacyUrl: verified.manifest.privacyUrl,
      },
    };
  }

  /**
   * `trustedKeys` defaults to the static, locally-configured allow-list merged with any
   * publisher keys previously learned via a marketplace install (unchanged behavior for the
   * trusted repository-update path, which does not pass it). The marketplace
   * purchase-install action passes an extended map that additionally trusts the one publisher key
   * named in that specific signed catalog release, so a newly-purchased publisher's package can
   * install without a manual PLUGIN_TRUSTED_KEYS edit -- the same bounded, signature-anchored
   * trust delegation already used for core/plugin update checks, not a new trust root.
   */
  async install(packageBuffer: Buffer, confirmedPackageSha256?: string, trustedKeys?: TrustedPluginKeys) {
    const coreVersion = readRuntimeConfig().appVersion;
    const verified = await this.verifier.verify(packageBuffer, trustedKeys ?? await trustedPluginKeys(), coreVersion);
    await this.artifactCache?.seed(packageBuffer, verified.packageSha256);
    if (confirmedPackageSha256 !== undefined && confirmedPackageSha256 !== verified.packageSha256) throw new BadRequestException('The package differs from the inspected package');
    await this.assertDependencies(verified);
    const current = await this.prisma.pluginInstallation.findUnique({ where: { id: verified.manifest.id } });
    const restoreActive = current?.status === 'active';
    if (restoreActive && !semver.gt(verified.manifest.version, current.version)) {
      throw new ConflictException(`Active plugin updates must increase the version: ${current.version} -> ${verified.manifest.version}`);
    }
    // An active dependency must be upgradable without first deactivating every dependent plugin.
    // Keep dependent registry state intact, briefly unload only the target runtime, replace its
    // signed artifact under the normal migration/locking pipeline, then reactivate it below.
    if (restoreActive) await this.runtime.unload(verified.manifest.id);
    if (verified.manifest.migrations.length > 0) {
      await this.migrations.createRecoveryPoint();
      // Visible progress marker: committed in its own short transaction (not the
      // locked install transaction below) so a concurrent reader — an admin
      // screen, a health check — can see "migrating" while the real work runs,
      // instead of the row appearing to sit unchanged until it either succeeds
      // or the process crashes.
      if (current) await this.prisma.pluginInstallation.update({ where: { id: verified.manifest.id }, data: { status: 'migrating' } }).catch(() => undefined);
    }

    const root = this.pluginRoot();
    const pluginRoot = path.join(root, verified.manifest.id);
    const destination = path.join(pluginRoot, verified.manifest.version);
    const staging = path.join(root, '.staging', `${verified.manifest.id}-${randomUUID()}`);
    await fs.mkdir(staging, { recursive: true, mode: 0o750 });
    try {
      for (const [name, content] of verified.files) {
        const target = path.resolve(staging, name);
        if (!target.startsWith(`${path.resolve(staging)}${path.sep}`)) throw new BadRequestException(`Unsafe extracted path: ${name}`);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
        await fs.writeFile(target, content, { mode: 0o640 });
      }
      await fs.mkdir(pluginRoot, { recursive: true, mode: 0o750 });
      await this.reconcileOrphanDestination(destination, verified);
      try {
        // Locked so a concurrent install/activate/deactivate/remove for this exact
        // plugin id cannot interleave with the file move, migration SQL, and
        // registry write below; the lock — and the fs move it protects — releases
        // deterministically even if this process crashes mid-transaction.
        const registered = await this.withPluginLock(verified.manifest.id, async (tx) => {
          await fs.rename(staging, destination);
          await this.migrations.apply(tx, verified);
          return tx.pluginInstallation.upsert({
            where: { id: verified.manifest.id },
            create: this.registryData(verified, destination),
            update: { ...this.registryData(verified, destination), status: 'installed', activatedAt: null, deactivatedAt: null, lastError: null },
          });
        });
        if (restoreActive) return this.activate(verified.manifest.id);
        return this.publicPlugin(registered);
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.pluginInstallation.updateMany({ where: { id: verified.manifest.id }, data: { status: 'failed', lastError: message } }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      // Failures before the registry swap leave the previous active installation authoritative.
      // Restore its runtime so a transient package/filesystem failure does not create downtime.
      if (restoreActive) {
        const registered = await this.prisma.pluginInstallation.findUnique({ where: { id: verified.manifest.id } }).catch(() => null);
        if (registered?.status === 'active') await this.runtime.load(verified.manifest.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async activate(id: string) {
    await this.entitlements?.assertCanActivate(id);
    let activationStarted = false;
    try {
      const activation = await this.withPluginLock(id, async (tx) => {
        const plugin = await this.getTx(tx, id);
        if (plugin.status === 'activating' || plugin.status === 'deactivating' || plugin.status === 'migrating') {
          throw new ConflictException(`Plugin ${id} is already ${plugin.status}; wait for the current operation to finish`);
        }
        const manifest = JSON.parse(plugin.manifestJson);
        await this.assertDependencies({ manifest } as VerifiedPluginPackage, tx);
        await fs.access(plugin.installedPath);
        for (const entry of [manifest.backendEntry, manifest.frontendEntry].filter(Boolean)) {
          await fs.access(path.join(plugin.installedPath, entry));
        }
        const updated = await tx.pluginInstallation.update({
          where: { id },
          // Activation is not complete until the signed package has loaded and passed its runtime
          // health check. Publishing "active" earlier creates a window where requests can be
          // routed to code that is not actually available.
          data: { status: 'activating', activatedAt: null, deactivatedAt: null, lastError: null },
        });
        const generation = this.rollout ? await this.rollout.stage(tx, plugin) : null;
        return { updated, generation };
      });
      activationStarted = true;
      await this.runtime.load(id);
      if (activation.generation) {
        await this.rollout!.report(activation.generation, activation.generation.sha256);
      } else {
        await this.withPluginLock(id, async (tx) => {
          const plugin = await this.getTx(tx, id);
          if (plugin.status !== 'activating') throw new ConflictException(`Plugin ${id} activation was superseded by ${plugin.status}`);
          await tx.pluginInstallation.update({
            where: { id },
            data: { status: 'active', activatedAt: new Date(), deactivatedAt: null, lastError: null },
          });
        });
      }
      return this.publicPlugin(await this.get(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (activationStarted) {
        await this.runtime.unload(id).catch(() => undefined);
        // Do not overwrite another operation's final state. Only the activation attempt that still
        // owns the transitional marker may turn it into a recoverable failure.
        await this.prisma.pluginInstallation.updateMany({ where: { id, status: 'activating' }, data: { status: 'failed', lastError: message } }).catch(() => undefined);
      } else {
        // Validation failures are recoverable, but an attempt against an already-active plugin
        // must never unload or downgrade the currently healthy runtime.
        await this.prisma.pluginInstallation.updateMany({
          where: { id, status: { in: ['installed', 'inactive', 'failed'] } },
          data: { status: 'failed', lastError: message },
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async rollback(id: string) {
    if (!this.rollout) throw new ConflictException('Artifact rollout generations are unavailable');
    await this.runtime.unload(id);
    const restored = await this.rollout.reactivatePrevious(id);
    await this.runtime.load(id);
    return this.publicPlugin(restored);
  }

  async deactivate(id: string) {
    const active = await this.prisma.pluginInstallation.findMany({ where: { status: { in: ['active', 'activating'] } }, select: { id: true, manifestJson: true } });
    const dependent = active.find((candidate) => {
      try { return Object.prototype.hasOwnProperty.call(JSON.parse(candidate.manifestJson).dependencies || {}, id); } catch { return false; }
    });
    if (dependent) throw new ConflictException(`Cannot deactivate ${id}; active plugin ${dependent.id} requires it`);
    const started = await this.withPluginLock(id, async (tx) => {
      const plugin = await this.getTx(tx, id);
      if (plugin.status === 'inactive' || plugin.status === 'installed') return { plugin, alreadyInactive: true };
      if (plugin.status === 'activating' || plugin.status === 'deactivating' || plugin.status === 'migrating') {
        throw new ConflictException(`Plugin ${id} is already ${plugin.status}; wait for the current operation to finish`);
      }
      const updated = await tx.pluginInstallation.update({
        where: { id }, data: { status: 'deactivating', lastError: null },
      });
      return { plugin: updated, alreadyInactive: false };
    });
    if (started.alreadyInactive) return this.publicPlugin(started.plugin);
    try {
      await this.runtime.unload(id);
      const updated = await this.withPluginLock(id, async (tx) => {
        const plugin = await this.getTx(tx, id);
        if (plugin.status !== 'deactivating') throw new ConflictException(`Plugin ${id} deactivation was superseded by ${plugin.status}`);
        return tx.pluginInstallation.update({
          where: { id }, data: { status: 'inactive', deactivatedAt: new Date(), lastError: null },
        });
      });
      return this.publicPlugin(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.pluginInstallation.updateMany({ where: { id, status: 'deactivating' }, data: { status: 'failed', lastError: message } }).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: string) {
    const plugin = await this.withPluginLock(id, async (tx) => {
      const found = await this.getTx(tx, id);
      if (found.status === 'active') throw new ConflictException(`Deactivate ${id} before removing it`);
      if (found.status === 'activating' || found.status === 'deactivating' || found.status === 'migrating') {
        throw new ConflictException(`Plugin ${id} is ${found.status}; wait for the current operation to finish before removing it`);
      }
      await tx.pluginInstallation.delete({ where: { id } });
      return found;
    });
    await this.runtime.unload(id);
    const root = this.pluginRoot();
    const pluginRoot = path.resolve(root, id);
    if (!pluginRoot.startsWith(`${root}${path.sep}`)) throw new BadRequestException('Plugin removal path is unsafe');
    await fs.rm(pluginRoot, { recursive: true, force: true });
    return { id: plugin.id, status: 'removed', dataPreserved: true };
  }

  private async get(id: string) {
    const plugin = await this.prisma.pluginInstallation.findUnique({ where: { id } });
    if (!plugin) throw new NotFoundException(`Plugin not installed: ${id}`);
    return plugin;
  }

  private async getTx(tx: Prisma.TransactionClient, id: string) {
    const plugin = await tx.pluginInstallation.findUnique({ where: { id } });
    if (!plugin) throw new NotFoundException(`Plugin not installed: ${id}`);
    return plugin;
  }

  private async assertDependencies(verified: Pick<VerifiedPluginPackage, 'manifest'>, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    for (const [id, range] of Object.entries(verified.manifest.dependencies)) {
      const dependency = await tx.pluginInstallation.findUnique({ where: { id } });
      if (!dependency || dependency.status !== 'active' || !semver.satisfies(dependency.version, range)) {
        throw new BadRequestException(`Plugin dependency is not active or compatible: ${id}@${range}`);
      }
    }
  }

  private registryData(verified: VerifiedPluginPackage, destination: string) {
    return {
      id: verified.manifest.id,
      name: verified.manifest.name,
      version: verified.manifest.version,
      publisher: verified.manifest.publisher,
      status: 'installed',
      manifestJson: JSON.stringify(verified.manifest),
      packageSha256: verified.packageSha256,
      installedPath: destination,
    };
  }

  private pluginRoot() {
    const root = path.resolve(process.env.PLUGIN_DIR || (process.env.NODE_ENV === 'production' ? '/data/plugins' : './plugins-installed'));
    if (root === path.parse(root).root) throw new BadRequestException('PLUGIN_DIR cannot be a filesystem root');
    return root;
  }

  private publicPlugin(plugin: any) {
    let manifest: any = {};
    try { manifest = JSON.parse(plugin.manifestJson); } catch { /* registry corruption is surfaced by status and activation */ }
    const optionalDependencies = manifest.optionalDependencies || {};
    return {
      id: plugin.id,
      name: plugin.name,
      description: manifest.description || '',
      version: plugin.version,
      publisher: plugin.publisher,
      status: plugin.status,
      capabilities: manifest.capabilities || [],
      permissions: manifest.permissions || [],
      requiresCore: manifest.requiresCore || null,
      packageSha256: plugin.packageSha256,
      installedAt: plugin.installedAt,
      activatedAt: plugin.activatedAt,
      deactivatedAt: plugin.deactivatedAt,
      lastError: plugin.lastError,
      dependencyState: { required: manifest.dependencies || {}, optional: optionalDependencies },
    };
  }
}
