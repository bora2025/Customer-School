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
import { ArtifactGeneration, PluginRolloutService } from './plugin-rollout.service';
import { PluginContractRuntimeService } from './plugin-contract-runtime.service';
import { PluginEntitlementPolicyService } from './plugin-entitlement-policy.service';
import { parsePluginUiBundle } from './plugin-ui-schema';
import { readMarketplaceIdentityConfig } from '../marketplace/marketplace-identity-config';
import { assertPluginExecutionAllowed, inProcessPluginPublishers, pluginExecutionDecision } from './plugin-execution-policy';

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
    const installedById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    return Promise.all(plugins.map(async (plugin) => ({
      ...this.publicPlugin(plugin),
      dependencyState: this.resolveDependencyState(plugin, plugins, installedById),
      rollbackAvailable: this.rollout ? !!await this.rollout.previous(plugin.id) : false,
      entitlement: this.entitlements ? await this.entitlements.decision(plugin.id) : null,
    })));
  }

  private resolveDependencyState(plugin: any, allPlugins: any[], installedById: Map<string, any>) {
    let manifest: any = {};
    try { manifest = JSON.parse(plugin.manifestJson || '{}'); } catch { /* reported by diagnostics */ }
    const resolve = (dependencies: Record<string, string> = {}) => Object.entries(dependencies).map(([id, range]) => {
      const installed = installedById.get(id);
      const compatible = !!installed && semver.satisfies(installed.version, range);
      return { id, range, installed: !!installed, installedVersion: installed?.version || null, status: installed?.status || 'missing', compatible, ready: compatible && installed.status === 'active' };
    });
    const requiredBy = allPlugins.flatMap((candidate) => {
      try {
        const dependencies = JSON.parse(candidate.manifestJson || '{}').dependencies || {};
        return dependencies[plugin.id] ? [{ id: candidate.id, name: candidate.name, range: dependencies[plugin.id], status: candidate.status }] : [];
      } catch { return []; }
    });
    return { required: resolve(manifest.dependencies), optional: resolve(manifest.optionalDependencies), requiredBy };
  }

  runtimeStatus() { return this.runtime.status(); }

  private inspectUi(verified: VerifiedPluginPackage) {
    const entry = verified.manifest.frontendEntry;
    if (!entry) return { present: false, portability: null, pageCount: 0, componentTypes: [] as string[] };
    const file = verified.files.get(entry);
    if (!file) throw new BadRequestException(`Plugin UI entry ${entry} is missing from the signed package`);
    let descriptor: unknown;
    try { descriptor = JSON.parse(file.toString('utf8')); }
    catch { throw new BadRequestException(`Plugin UI entry ${entry} is not valid JSON`); }
    if ((descriptor as any)?.schemaVersion === 1 && Array.isArray((descriptor as any)?.pages)) {
      if (verified.manifest.sdkVersion && semver.gte(semver.coerce(verified.manifest.sdkVersion) || '0.0.0', '1.3.0')) {
        throw new BadRequestException('SDK 1.3 plugins must use the universal declarative UI contract');
      }
      const pages = (descriptor as any).pages;
      return { present: true, portability: 'legacy-schema-1-adapter', pageCount: pages.length, componentTypes: [...new Set<string>(pages.flatMap((page: any) => (page.components || []).map((component: any) => String(component.type))))].sort() };
    }
    if ((descriptor as any)?.schemaVersion === 1 && (descriptor as any)?.kind === 'json-settings') {
      return { present: true, portability: 'legacy-json-settings', pageCount: 1, componentTypes: ['json-settings'] };
    }
    const bundle = parsePluginUiBundle(descriptor, verified.manifest.id, new Set(verified.manifest.permissions));
    return {
      present: true,
      portability: bundle.portability || 'legacy-host-components',
      pageCount: bundle.pages.length,
      componentTypes: [...new Set(bundle.pages.flatMap((page) => page.components.map((component) => component.type)))].sort(),
    };
  }

  async diagnostics() {
    const [plugins, jobs, deployment] = await Promise.all([
      this.prisma.pluginInstallation.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.pluginJobDefinition.findMany({ orderBy: [{ pluginId: 'asc' }, { jobId: 'asc' }] }),
      this.deploymentReadiness(),
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
      status: !deployment.ready || results.some((plugin) => plugin.status === 'failed') ? 'failed' : results.some((plugin) => plugin.status === 'degraded') || deployment.checks.some((check) => check.status === 'warning') ? 'degraded' : 'healthy',
      safeMode: runtime.safeMode, checkedAt: new Date().toISOString(), deployment, plugins: results,
    };
  }

  private async deploymentReadiness() {
    type Check = { id: string; status: 'passed' | 'failed' | 'warning'; message: string };
    const checks: Check[] = [];
    const pass = (id: string, message: string): void => { checks.push({ id, status: 'passed', message }); };
    const fail = (id: string, message: string): void => { checks.push({ id, status: 'failed', message }); };
    const warn = (id: string, message: string): void => { checks.push({ id, status: 'warning', message }); };
    const config = readRuntimeConfig();
    const platform = process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID ? 'managed-cloud' : 'self-hosted-vps';
    const backendPublishers = [...inProcessPluginPublishers()].sort();
    if (backendPublishers.length) pass('backend-execution-policy', `In-process backend execution is limited to: ${backendPublishers.join(', ')}`);
    else fail('backend-execution-policy', 'No publisher is allowed to execute backend plugin code');

    for (const [id, directory] of [['plugin-files', config.pluginDir], ['plugin-data', config.pluginDataDir]] as const) {
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.access(directory, fs.constants.R_OK | fs.constants.W_OK);
        pass(id, `${directory} is readable and writable`);
      } catch (error) { fail(id, `${directory} is not usable: ${error instanceof Error ? error.message : String(error)}`); }
    }

    try {
      const keys = await trustedPluginKeys(this.prisma);
      const publishers = Object.keys(keys);
      if (publishers.length) pass('publisher-trust', `${publishers.length} publisher trust record(s) are available`);
      else warn('publisher-trust', 'No publisher key is stored yet; link Marketplace before installing the first plugin');
    } catch (error) { fail('publisher-trust', error instanceof Error ? error.message : String(error)); }

    try {
      const marketplace = readMarketplaceIdentityConfig();
      if (!marketplace) warn('marketplace', 'MARKETPLACE_URL is not configured; signed marketplace discovery, purchase, and artifact recovery are unavailable');
      else {
        pass('marketplace', `Marketplace origin is ${marketplace.marketplaceUrl}`);
        try {
          await fs.mkdir(marketplace.installationKeyDir, { recursive: true });
          await fs.access(marketplace.installationKeyDir, fs.constants.R_OK | fs.constants.W_OK);
          pass('installation-identity', `${marketplace.installationKeyDir} can retain the school identity key`);
        } catch (error) { fail('installation-identity', `School identity storage is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      }
    } catch (error) { fail('marketplace', error instanceof Error ? error.message : String(error)); }

    const requiredRoles = (process.env.PLUGIN_REQUIRED_RUNTIME_ROLES || '').split(',').map((role) => role.trim()).filter(Boolean);
    if (config.processRole === 'combined') pass('runtime-roles', 'Combined API/worker runtime uses one verified artifact generation');
    else if (requiredRoles.includes('api') && requiredRoles.includes('worker')) pass('runtime-roles', 'Rollout requires both API and worker readiness');
    else fail('runtime-roles', 'Split deployment must set PLUGIN_REQUIRED_RUNTIME_ROLES=api,worker on every API and worker service');

    if (config.nodeEnv === 'production' && !path.isAbsolute(config.pluginDir)) fail('persistent-storage', 'PLUGIN_DIR must be an absolute persistent path in production');
    else if (platform === 'managed-cloud' && !process.env.PLUGIN_DIR) fail('persistent-storage', 'Managed cloud must explicitly mount and set PLUGIN_DIR; container-local defaults are not durable');
    else pass('persistent-storage', 'Plugin paths are explicit and suitable for backup/restore verification');

    return { platform, ready: checks.every((check) => check.status !== 'failed'), checks };
  }

  async activationPreflight(id: string) {
    const plugin = await this.get(id);
    const checks: Array<{ id: string; status: 'passed' | 'failed' | 'warning'; message: string; details?: unknown }> = [];
    let verified: VerifiedPluginPackage | null = null;
    const pass = (checkId: string, message: string, details?: unknown) => checks.push({ id: checkId, status: 'passed', message, ...(details === undefined ? {} : { details }) });
    const fail = (checkId: string, error: unknown) => checks.push({ id: checkId, status: 'failed', message: error instanceof Error ? error.message : String(error) });

    try {
      verified = await this.verifier.verifyInstalledDirectory(plugin.installedPath, await trustedPluginKeys(this.prisma), readRuntimeConfig().appVersion);
      if (verified.manifest.id !== plugin.id || verified.manifest.version !== plugin.version) throw new Error(`Installed identity ${verified.manifest.id}@${verified.manifest.version} does not match registry ${plugin.id}@${plugin.version}`);
      pass('artifact-integrity', 'Installed files, checksums, publisher signature, identity, and core compatibility are valid');
    } catch (error) { fail('artifact-integrity', error); }

    if (verified) {
      try {
        const execution = assertPluginExecutionAllowed(verified.manifest);
        pass('execution-policy', execution.reason, execution);
      } catch (error) { fail('execution-policy', error); }
      try {
        const ui = this.inspectUi(verified);
        pass('ui-contract', ui.present ? `UI contract is valid (${ui.portability}, ${ui.pageCount} pages)` : 'Plugin does not declare a UI', ui);
      } catch (error) { fail('ui-contract', error); }
      try { await this.assertDependencies(verified); pass('dependencies', 'Required plugin dependencies are installed and compatible'); }
      catch (error) { fail('dependencies', error); }
      try {
        const applied = await this.prisma.pluginMigration.findMany({ where: { pluginId: id }, select: { migrationId: true, checksum: true } });
        const appliedById = new Map(applied.map((migration) => [migration.migrationId, migration.checksum]));
        const missing = verified.manifest.migrations.filter((migration) => !appliedById.has(migration.id)).map((migration) => migration.id);
        const changed = verified.manifest.migrations.filter((migration) => appliedById.has(migration.id) && appliedById.get(migration.id) !== migration.checksum).map((migration) => migration.id);
        if (missing.length || changed.length) throw new Error(`Migration state is inconsistent${missing.length ? `; not applied: ${missing.join(', ')}` : ''}${changed.length ? `; checksum mismatch: ${changed.join(', ')}` : ''}`);
        pass('migrations', `${verified.manifest.migrations.length} declared migrations are applied with matching checksums`);
      } catch (error) { fail('migrations', error); }
    }

    try {
      const entitlement = this.entitlements ? await this.entitlements.decision(id) : null;
      if (entitlement?.mode === 'read_only') throw new Error(entitlement.reason || 'Plugin entitlement is read-only');
      pass('entitlement', entitlement ? `Entitlement permits activation (${entitlement.mode})` : 'No external entitlement is required', entitlement);
    } catch (error) { fail('entitlement', error); }

    const runtime = this.runtime.status();
    if (runtime.safeMode) fail('runtime', new Error('Plugin activation is disabled while PLUGIN_SAFE_MODE is enabled'));
    else if (plugin.status === 'active' && !runtime.loaded.includes(id)) fail('runtime', new Error('Registry says active but the plugin runtime is not loaded'));
    else pass('runtime', plugin.status === 'active' ? 'Plugin runtime is loaded' : 'Plugin runtime is available for activation');

    return {
      plugin: { id: plugin.id, name: plugin.name, version: plugin.version, status: plugin.status },
      ready: checks.every((check) => check.status !== 'failed'),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }
  contractHealth(id: string) { if (!this.contracts) throw new ConflictException('Plugin contract runtime is unavailable'); return this.contracts.health(id); }
  replayDeadLetter(id: string, deadLetterId: string) { if (!this.contracts) throw new ConflictException('Plugin contract runtime is unavailable'); return this.contracts.replay(id, deadLetterId); }

  async inspect(packageBuffer: Buffer) {
    const verified = await this.verifier.verify(packageBuffer, await trustedPluginKeys(this.prisma), readRuntimeConfig().appVersion);
    await this.assertDependencies(verified);
    const ui = this.inspectUi(verified);
    const execution = pluginExecutionDecision(verified.manifest);
    return {
      packageSha256: verified.packageSha256,
      checks: { signature: 'valid', coreCompatibility: 'compatible', dependencies: 'satisfied', execution, ui },
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
    const verified = await this.verifier.verify(packageBuffer, trustedKeys ?? await trustedPluginKeys(this.prisma), coreVersion);
    assertPluginExecutionAllowed(verified.manifest);
    this.inspectUi(verified);
    await this.artifactCache?.seed(packageBuffer, verified.packageSha256);
    if (confirmedPackageSha256 !== undefined && confirmedPackageSha256 !== verified.packageSha256) throw new BadRequestException('The package differs from the inspected package');
    await this.assertDependencies(verified);
    const current = await this.prisma.pluginInstallation.findUnique({ where: { id: verified.manifest.id } });
    const root = this.pluginRoot();
    const pluginRoot = path.join(root, verified.manifest.id);
    const destination = path.join(pluginRoot, verified.manifest.version);
    const sameCommittedPackage = current?.version === verified.manifest.version && current?.packageSha256 === verified.packageSha256;
    if (sameCommittedPackage) {
      try {
        await fs.access(destination);
        // Retrying an already-committed install is idempotent. Older builds set `migrating`
        // before noticing this duplicate artifact, so also repair that stranded marker from the
        // timestamps that describe the last stable lifecycle state.
        if (current.status === 'migrating') {
          const status = current.deactivatedAt ? 'inactive' : current.activatedAt ? 'active' : 'installed';
          const recovered = await this.prisma.pluginInstallation.update({
            where: { id: verified.manifest.id }, data: { status, lastError: null },
          });
          return this.publicPlugin(recovered);
        }
        return this.publicPlugin(current);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
        // The registry exists but its artifact does not. Continue through the normal install
        // pipeline so the signed package repairs the missing files.
      }
    }
    const restoreActive = current?.status === 'active';
    if (restoreActive && !semver.gt(verified.manifest.version, current.version)) {
      throw new ConflictException(`Active plugin updates must increase the version: ${current.version} -> ${verified.manifest.version}`);
    }
    // An active dependency must be upgradable without first deactivating every dependent plugin.
    // Keep dependent registry state intact, briefly unload only the target runtime, replace its
    // signed artifact under the normal migration/locking pipeline, then reactivate it below.
    if (restoreActive) await this.runtime.unload(verified.manifest.id);
    if (verified.manifest.migrations.length > 0) {
      try {
        await this.migrations.createRecoveryPoint();
      } catch (error) {
        // The authoritative registry still points at the previous active generation here. A
        // recovery-point failure must therefore restore its runtime before the update exits.
        if (restoreActive) await this.runtime.load(verified.manifest.id).catch(() => undefined);
        throw error;
      }
      // Visible progress marker: committed in its own short transaction (not the
      // locked install transaction below) so a concurrent reader — an admin
      // screen, a health check — can see "migrating" while the real work runs,
      // instead of the row appearing to sit unchanged until it either succeeds
      // or the process crashes.
      if (current) await this.prisma.pluginInstallation.update({ where: { id: verified.manifest.id }, data: { status: 'migrating' } }).catch(() => undefined);
    }

    const staging = path.join(root, '.staging', `${verified.manifest.id}-${randomUUID()}`);
    try {
      await fs.mkdir(staging, { recursive: true, mode: 0o750 });
    } catch (error) {
      if (restoreActive) await this.runtime.load(verified.manifest.id).catch(() => undefined);
      throw error;
    }
    let previousRestored = false;
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
        // Await inside this try so an asynchronous activation/health failure is handled by the
        // automatic previous-version restoration below instead of escaping past its catch block.
        if (restoreActive) return await this.activate(verified.manifest.id);
        return this.publicPlugin(registered);
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        if (restoreActive && current) {
          try {
            await this.prisma.pluginInstallation.update({
              where: { id: current.id },
              data: {
                name: current.name, version: current.version, publisher: current.publisher,
                manifestJson: current.manifestJson, packageSha256: current.packageSha256,
                installedPath: current.installedPath, status: 'active', activatedAt: current.activatedAt || new Date(),
                deactivatedAt: null, lastError: null,
              },
            });
            await this.runtime.load(current.id);
            previousRestored = true;
          } catch (restoreError) {
            const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
            await this.prisma.pluginInstallation.updateMany({ where: { id: verified.manifest.id }, data: { status: 'failed', lastError: `${message}; automatic rollback failed: ${restoreMessage}` } }).catch(() => undefined);
          }
        } else {
          await this.prisma.pluginInstallation.updateMany({ where: { id: verified.manifest.id }, data: { status: 'failed', lastError: message } }).catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      // Failures before the registry swap leave the previous active installation authoritative.
      // Restore its runtime so a transient package/filesystem failure does not create downtime.
      if (restoreActive && !previousRestored) {
        const registered = await this.prisma.pluginInstallation.findUnique({ where: { id: verified.manifest.id } }).catch(() => null);
        if (registered?.status === 'active') await this.runtime.load(verified.manifest.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async activate(id: string) {
    await this.entitlements?.assertCanActivate(id);
    let activationStarted = false;
    let stagedGeneration: ArtifactGeneration | null = null;
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
        stagedGeneration = generation;
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
      if (stagedGeneration && this.rollout) await this.rollout.fail(stagedGeneration, message).catch(() => undefined);
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
