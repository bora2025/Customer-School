import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { createRequire } from 'node:module';
import path from 'path';
import semver from 'semver';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { readRuntimeConfig } from '../config/environment';
import { trustedPluginKeys } from './plugin-config';
import { PluginEventBus } from './plugin-events';
import { PluginPackageVerifier } from './plugin-package';
import { PluginExtensionsService } from './plugin-extensions.service';
import { PluginJobsService } from './plugin-jobs.service';
import { PluginSettingsService } from './plugin-settings.service';
import { PluginStorageService } from './plugin-storage.service';
import { NotificationService } from '../notification/notification.service';
import { DirectoryService } from '../directory/directory.service';
import { PluginRealtimeService } from './plugin-realtime.service';
import { PluginNotificationQuotaService } from './plugin-notification-quota.service';
import { AuditService } from '../audit/audit.service';
import { assertNoForbiddenSql, assertPluginNamespace } from './plugin-sql-guard';
import { PluginRuntimeContext, RuntimePluginModule } from './plugin-sdk';
import { PluginArtifactCacheService } from './plugin-artifact-cache.service';
import { PluginResourceQuotaService } from './plugin-resource-quota.service';
import { PluginContractRuntimeService } from './plugin-contract-runtime.service';
import { PluginRolloutService } from './plugin-rollout.service';
import { PrismaAcademicIdentityProvider } from '../auth/academic-identity.provider';
import { PluginAccountService } from './plugin-account.service';

@Injectable()
export class PluginRuntimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PluginRuntimeService.name);
  private readonly loaded = new Map<string, { module: RuntimePluginModule; context: PluginRuntimeContext; cleanup?: () => void; disposers: Array<() => void> }>();
  private rolloutTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: PluginPackageVerifier,
    private readonly eventBus: PluginEventBus,
    private readonly extensions: PluginExtensionsService,
    private readonly jobs: PluginJobsService,
    private readonly settings: PluginSettingsService,
    private readonly storage: PluginStorageService,
    private readonly notifications: NotificationService,
    private readonly directory: DirectoryService,
    private readonly realtime: PluginRealtimeService,
    private readonly notificationQuota: PluginNotificationQuotaService,
    private readonly audit: AuditService,
    @Optional() private readonly artifactCache?: PluginArtifactCacheService,
    @Optional() private readonly resourceQuota?: PluginResourceQuotaService,
    @Optional() private readonly contracts?: PluginContractRuntimeService,
    @Optional() private readonly rollout?: PluginRolloutService,
    @Optional() private readonly academicIdentity?: PrismaAcademicIdentityProvider,
    @Optional() private readonly pluginAccounts?: PluginAccountService,
  ) {}

  async onApplicationBootstrap() {
    if (this.safeMode()) {
      this.logger.warn('PLUGIN_SAFE_MODE is enabled; no plugin code will be loaded');
      return;
    }
    // Finish safe lifecycle outcomes after a process restart. A deactivation that lost power after
    // unloading must stay off; a local activation interrupted before readiness must be retried by
    // an administrator. Distributed rollout activations are reconciled below instead.
    await this.prisma.pluginInstallation.updateMany({
      where: { status: 'deactivating' },
      data: { status: 'inactive', deactivatedAt: new Date(), lastError: null },
    });
    if (!this.rollout) {
      await this.prisma.pluginInstallation.updateMany({
        where: { status: 'activating' },
        data: { status: 'failed', lastError: 'Activation was interrupted by a server restart; retry activation' },
      });
    }
    await this.reconcileRollouts();
    if (this.rollout) { this.rolloutTimer = setInterval(() => void this.reconcileRollouts(), 2_000); this.rolloutTimer.unref(); }
    const active = await this.prisma.pluginInstallation.findMany({ where: { status: 'active' } });
    for (const plugin of active) {
      try { await this.load(plugin.id); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to load ${plugin.id}: ${message}`);
        await this.prisma.pluginInstallation.update({ where: { id: plugin.id }, data: { status: 'failed', lastError: message } });
      }
    }
    this.eventBus.publish('core.system.started.v1', { startedAt: new Date().toISOString() });
  }

  async onApplicationShutdown() {
    if (this.rolloutTimer) clearInterval(this.rolloutTimer);
    for (const id of [...this.loaded.keys()].reverse()) await this.unload(id);
  }

  private async reconcileRollouts() {
    if (!this.rollout) return;
    const pending = await this.rollout.pendingForCurrentRole().catch(() => []);
    for (const generation of pending) {
      try { await this.load(generation.pluginId); await this.rollout.report(generation, generation.sha256); }
      catch (error) { await this.rollout.report(generation, generation.sha256, error instanceof Error ? error.message : String(error)).catch(() => undefined); }
    }
  }

  async load(id: string) {
    if (this.safeMode()) throw new Error('Plugin activation is disabled while PLUGIN_SAFE_MODE is enabled');
    if (this.loaded.has(id)) return;
    const record = await this.prisma.pluginInstallation.findUnique({ where: { id } });
    if (!record) throw new Error(`Plugin registry entry not found: ${id}`);
    const root = this.pluginRoot();
    const cached = this.artifactCache ? await this.artifactCache.ensure(record) : null;
    const installedPath = path.resolve(cached?.directory || record.installedPath);
    if (!installedPath.startsWith(`${root}${path.sep}`)) throw new Error(`Plugin path is outside PLUGIN_DIR: ${id}`);
    const verified = cached?.verified || await this.verifier.verifyInstalledDirectory(installedPath, await trustedPluginKeys(), readRuntimeConfig().appVersion);
    if (verified.manifest.id !== id || verified.manifest.version !== record.version) throw new Error('Installed plugin identity does not match registry');
    if (!verified.manifest.backendEntry) return;
    const entry = path.resolve(installedPath, verified.manifest.backendEntry);
    if (!entry.startsWith(`${installedPath}${path.sep}`)) throw new Error('Plugin backend entry escapes installation directory');
    // Use Node's native resolver explicitly. A direct dynamic `require(entry)` is rewritten by
    // webpack into an empty bundle context and therefore cannot load signed plugins installed on
    // the persistent volume after the core image was built.
    const runtimeRequire = createRequire(path.join(installedPath, '.wattanam-plugin-runtime.cjs'));
    const resolvedEntry = runtimeRequire.resolve(entry);
    delete runtimeRequire.cache[resolvedEntry];
    const pluginModule = runtimeRequire(resolvedEntry) as RuntimePluginModule;
    if (pluginModule.id !== id || typeof pluginModule.activate !== 'function') throw new Error('Plugin backend entry does not implement the lifecycle contract');

    const capabilities = new Set(verified.manifest.capabilities);
    const declaredPermissions = new Set(verified.manifest.permissions);
    const logger = new Logger(`Plugin:${id}`);
    const disposers: Array<() => void> = [];
    const requireCapability = (capability: string) => {
      if (!capabilities.has(capability)) throw new Error(`${id} did not declare ${capability}`);
    };
    const context: PluginRuntimeContext = {
      sdkVersion: '1.1.0',
      pluginId: id,
      logger,
      dependencies: {
        required: verified.manifest.dependencies,
        optional: verified.manifest.optionalDependencies || {},
        isAvailable: async (pluginId) => {
          const range = verified.manifest.dependencies[pluginId] || verified.manifest.optionalDependencies?.[pluginId];
          if (!range) return false;
          const dependency = await this.prisma.pluginInstallation.findUnique({ where: { id: pluginId }, select: { status: true, version: true } });
          return !!dependency && dependency.status === 'active' && semver.satisfies(dependency.version, range);
        },
      },
      events: {
        publish: (event, payload) => {
          requireCapability('events.publish');
          this.eventBus.publish(event, payload);
        },
        subscribe: (event, handler) => {
          requireCapability('events.subscribe');
          const dispose = this.eventBus.subscribe(event, handler); disposers.push(dispose); return dispose;
        },
      },
      durableEvents: {
        subscribe: (definition) => {
          requireCapability('events.durable');
          if (!this.contracts) throw new Error('Durable event runtime is unavailable');
          const dispose = this.contracts.subscribe(id, definition); disposers.push(dispose); return dispose;
        },
      },
      routes: { register: (definition) => { requireCapability('api.routes'); const dispose = this.extensions.registerRoute(id, declaredPermissions, definition); disposers.push(dispose); return dispose; } },
      jobs: { register: async (definition) => { requireCapability('jobs.schedule'); const dispose = await this.jobs.register(id, definition); disposers.push(dispose); return dispose; } },
      settings: {
        get: (key, fallback) => { requireCapability('settings.read'); return this.settings.get(id, key, fallback); },
        set: (key, value) => { requireCapability('settings.write'); return this.settings.set(id, key, value); },
        delete: (key) => { requireCapability('settings.write'); return this.settings.delete(id, key); },
      },
      storage: {
        readText: (name) => { requireCapability('storage.read'); return this.storage.readText(id, name); },
        writeText: (name, value) => { requireCapability('storage.write'); return this.storage.writeText(id, name, value); },
        readBinary: (name) => { requireCapability('storage.read'); return this.storage.readBinary(id, name); },
        writeBinary: (name, value) => { requireCapability('storage.write'); return this.storage.writeBinary(id, name, value); },
        delete: (name) => { requireCapability('storage.write'); return this.storage.delete(id, name); },
        list: (prefix) => { requireCapability('storage.read'); return this.storage.list(id, prefix); },
      },
      permissions: { register: (definitions) => { requireCapability('permissions.register'); const dispose = this.extensions.registerPermissions(id, declaredPermissions, definitions.map((definition) => ({ ...definition, pluginId: id }))); disposers.push(dispose); return dispose; } },
      navigation: { register: (entries) => { requireCapability('navigation.register'); const dispose = this.extensions.registerNavigation(id, declaredPermissions, entries.map((entry) => ({ ...entry, pluginId: id }))); disposers.push(dispose); return dispose; } },
      notifications: {
        sendEmail: (to, subject, text) => { requireCapability('notifications.send'); return this.sendNotification(id, 'email', { to, subject }, () => this.notifications.sendEmail(to, subject, text)); },
        sendSms: (to, body) => { requireCapability('notifications.send'); return this.sendNotification(id, 'sms', { to }, () => this.notifications.sendSms(to, body)); },
        notifyInApp: (userId, message, type) => { requireCapability('notifications.send'); return this.sendNotification(id, 'in_app', { to: userId, type }, () => this.notifications.notifyInApp(userId, message, type)); },
      },
      database: {
        query: (sql, params = []) => {
          requireCapability('database.read');
          this.resourceQuota?.consume(id, 'sql');
          const label = `Plugin ${id} query`;
          if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`${label} must be a SELECT statement`);
          if ((sql.match(/;/g) || []).length > 1) throw new Error(`${label} must contain exactly one SQL statement`);
          assertNoForbiddenSql(sql, label);
          assertPluginNamespace(id, sql, label);
          return this.prisma.$queryRawUnsafe(sql, ...params);
        },
        execute: async (sql, params = []) => {
          requireCapability('database.write');
          this.resourceQuota?.consume(id, 'sql');
          const label = `Plugin ${id} execute`;
          if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error(`${label} must be an INSERT, UPDATE, or DELETE statement`);
          if ((sql.match(/;/g) || []).length > 1) throw new Error(`${label} must contain exactly one SQL statement`);
          assertNoForbiddenSql(sql, label);
          assertPluginNamespace(id, sql, label);
          const count = await this.prisma.$executeRawUnsafe(sql, ...params);
          return { count };
        },
        transaction: async (work) => {
          requireCapability('database.write'); requireCapability('events.durable');
          if (!this.contracts) throw new Error('Durable event runtime is unavailable');
          return this.prisma.$transaction(async (tx) => work({
            query: (sql, params = []) => {
              this.resourceQuota?.consume(id, 'sql'); const label = `Plugin ${id} transactional query`;
              if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`${label} must be a SELECT statement`);
              assertNoForbiddenSql(sql, label); assertPluginNamespace(id, sql, label); return tx.$queryRawUnsafe(sql, ...params);
            },
            execute: async (sql, params = []) => {
              this.resourceQuota?.consume(id, 'sql'); const label = `Plugin ${id} transactional execute`;
              if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error(`${label} must be an INSERT, UPDATE, or DELETE statement`);
              assertNoForbiddenSql(sql, label); assertPluginNamespace(id, sql, label); return { count: await tx.$executeRawUnsafe(sql, ...params) };
            },
            publish: (input) => this.contracts!.publish(tx, id, input),
          }));
        },
      },
      readModels: {
        publish: (model, version, key, data) => { requireCapability('readmodels.publish'); if (!this.contracts) throw new Error('Read-model runtime is unavailable'); return this.contracts.putReadModel(id, model, version, key, data); },
        read: (owner, model, versions, recordKey) => { requireCapability('readmodels.read'); if (!this.contracts) throw new Error('Read-model runtime is unavailable'); return this.contracts.readModel(owner, model, versions, recordKey); },
      },
      directory: {
        resolveAudience: (query) => { requireCapability('directory.read'); return this.directory.resolveAudience(query); },
        lookupUsers: (ids) => { requireCapability('directory.read'); return this.directory.lookupUsers(ids); },
        lookupClasses: (ids) => { requireCapability('directory.read'); return this.directory.lookupClasses(ids); },
        lookupSubjects: (ids) => { requireCapability('directory.read'); return this.directory.lookupSubjects(ids); },
        classesForUser: (userId, role) => { requireCapability('directory.read'); return this.directory.classesForUser(userId, role); },
        getClassRoster: (classId, asOfIsoDate) => { requireCapability('directory.read'); return this.directory.getClassRoster(classId, asOfIsoDate); },
        getEnrollmentAtDate: (studentId, asOfIsoDate) => { requireCapability('directory.read'); return this.directory.getEnrollmentAtDate(studentId, asOfIsoDate); },
      },
      realtime: {
        notifyUser: (userId, event, payload) => { requireCapability('realtime.notify'); this.resourceQuota?.consume(id, 'realtime'); this.realtime.notifyUser(id, userId, event, payload); },
      },
      crypto: {
        hashBcrypt: (plaintext, rounds = 12) => { requireCapability('crypto.hash'); return bcrypt.hash(plaintext, rounds); },
      },
      accounts: {
        createStudent: async (input) => {
          requireCapability('accounts.student.create');
          if (!this.pluginAccounts) throw new Error('Core student-account command adapter is unavailable');
          try {
            const account = await this.pluginAccounts.createStudent(id, input);
            void this.audit.log({ action: 'PLUGIN_STUDENT_ACCOUNT_CREATE', resource: 'USER', resourceId: account.id, metadata: { pluginId: id, commandKey: input.commandKey }, success: true });
            return account;
          } catch (error) {
            void this.audit.log({ action: 'PLUGIN_STUDENT_ACCOUNT_CREATE', resource: 'USER', metadata: { pluginId: id, commandKey: input.commandKey }, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
        updateStudent: async (input) => {
          requireCapability('accounts.student.update');
          if (!this.pluginAccounts) throw new Error('Core student-account command adapter is unavailable');
          try {
            const account = await this.pluginAccounts.updateStudent(id, input);
            void this.audit.log({ action: 'PLUGIN_STUDENT_ACCOUNT_UPDATE', resource: 'USER', resourceId: account.id, metadata: { pluginId: id, commandKey: input.commandKey }, success: true });
            return account;
          } catch (error) {
            void this.audit.log({ action: 'PLUGIN_STUDENT_ACCOUNT_UPDATE', resource: 'USER', resourceId: input.userId, metadata: { pluginId: id, commandKey: input.commandKey }, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
        resolveParent: async (input) => {
          requireCapability('accounts.parent.resolve');
          if (!this.pluginAccounts) throw new Error('Core parent-account command adapter is unavailable');
          try {
            const account = await this.pluginAccounts.resolveParent(id, input);
            void this.audit.log({ action: 'PLUGIN_PARENT_ACCOUNT_RESOLVE', resource: 'USER', resourceId: account.id, metadata: { pluginId: id, commandKey: input.commandKey, created: account.created }, success: true });
            return account;
          } catch (error) {
            void this.audit.log({ action: 'PLUGIN_PARENT_ACCOUNT_RESOLVE', resource: 'USER', metadata: { pluginId: id, commandKey: input.commandKey }, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
        assignGuardian: async (input) => {
          requireCapability('accounts.guardian.assign');
          if (!this.academicIdentity) throw new Error('Academic guardian command adapter is unavailable');
          try {
            await this.academicIdentity.assignStudentParent(input);
            void this.audit.log({ action: 'PLUGIN_GUARDIAN_ASSIGN', resource: 'USER', resourceId: input.studentUserId, metadata: { pluginId: id, parentId: input.parentId }, success: true });
          } catch (error) {
            void this.audit.log({ action: 'PLUGIN_GUARDIAN_ASSIGN', resource: 'USER', resourceId: input.studentUserId, metadata: { pluginId: id, parentId: input.parentId }, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
      },
    };
    try {
      if (verified.manifest.frontendEntry) {
        requireCapability('ui.pages');
        let descriptor: unknown;
        try { descriptor = JSON.parse(verified.files.get(verified.manifest.frontendEntry)!.toString('utf8')); }
        catch { throw new Error('Plugin frontend entry must be valid declarative JSON'); }
        const dispose = this.extensions.registerPage(id, descriptor, declaredPermissions); disposers.push(dispose);
      }
      const cleanup = await pluginModule.activate(context);
      if (id === 'wattanam.academic-management') {
        const principal = { userId: 'core:academic-contract', role: 'SUPER_ADMIN' };
        const dispose = this.directory.bindAcademicPluginContracts({
          getClassRoster: (classId, asOfIsoDate) => this.extensions.dispatch(id, {
            method: 'GET', path: `contracts/classes/${encodeURIComponent(classId)}/roster`, params: {},
            query: { asOfIsoDate }, body: null, principal,
          }),
          getEnrollmentAtDate: (studentId, asOfIsoDate) => this.extensions.dispatch(id, {
            method: 'GET', path: `contracts/students/${encodeURIComponent(studentId)}/enrollment`, params: {},
            query: { asOfIsoDate }, body: null, principal,
          }),
          resolveClassAudience: (classId) => this.extensions.dispatch(id, {
            method: 'GET', path: `contracts/classes/${encodeURIComponent(classId)}/audience`, params: {},
            query: {}, body: null, principal,
          }),
          resolveClassesForUser: (userId, role) => this.extensions.dispatch(id, {
            method: 'GET', path: `contracts/users/${encodeURIComponent(userId)}/classes`, params: {},
            query: { role }, body: null, principal,
          }),
          lookupClasses: (ids) => this.extensions.dispatch(id, {
            method: 'GET', path: 'contracts/classes/lookup', params: {},
            query: { ids }, body: null, principal,
          }),
          lookupSubjects: (ids) => this.extensions.dispatch(id, {
            method: 'GET', path: 'contracts/subjects/lookup', params: {},
            query: { ids }, body: null, principal,
          }),
          departmentForUser: (userId) => this.extensions.dispatch(id, {
            method: 'GET', path: `contracts/users/${encodeURIComponent(userId)}/department`, params: {},
            query: {}, body: null, principal,
          }),
        });
        disposers.push(dispose);
        if (this.academicIdentity) {
          const disposeIdentity = this.academicIdentity.bindAcademicPluginCommands({
            assignUserDepartment: (input) => this.extensions.dispatch(id, {
              method: 'PUT', path: `commands/users/${encodeURIComponent(input.userId)}/department`, params: {},
              query: {}, body: { departmentId: input.departmentId, idempotencyKey: input.idempotencyKey }, principal,
            }),
            assignStudentParent: (input) => this.extensions.dispatch(id, {
              method: 'PUT', path: `commands/students/by-user/${encodeURIComponent(input.studentUserId)}/guardian`, params: {},
              query: {}, body: { parentId: input.parentId, idempotencyKey: input.idempotencyKey }, principal,
            }),
            detachUserAcademicIdentity: (input) => this.extensions.dispatch(id, {
              method: 'DELETE', path: `commands/users/${encodeURIComponent(input.userId)}/academic-identity`, params: {},
              query: {}, body: { idempotencyKey: input.idempotencyKey }, principal,
            }),
            attachAcademicProfiles: (userIds) => this.extensions.dispatch(id, {
              method: 'POST', path: 'contracts/users/academic-profiles', params: {}, query: {},
              body: { userIds }, principal,
            }),
          });
          disposers.push(disposeIdentity);
        }
      }
      if (pluginModule.health) {
        const health = await pluginModule.health();
        if (health === false || (health && typeof health === 'object' && (health as any).status === 'failed')) throw new Error('Plugin health check failed');
      }
      this.loaded.set(id, { module: pluginModule, context, cleanup: typeof cleanup === 'function' ? cleanup : undefined, disposers });
      this.logger.log(`Activated ${id}@${record.version}`);
    } catch (error) {
      for (const dispose of disposers.reverse()) { try { dispose(); } catch { /* best effort */ } }
      this.extensions.clear(id); await this.jobs.clear(id);
      throw error;
    }
  }

  /**
   * Every plugin notification send goes through here: checked against the
   * plugin's daily quota (a single atomic upsert-increment, so concurrent
   * sends from the same plugin can't race past the limit) and audit-logged
   * (denied, failed, or succeeded), mirroring how PluginExtensionsService
   * already audits every route dispatch.
   */
  private async sendNotification<T>(pluginId: string, channel: string, metadata: Record<string, unknown>, send: () => Promise<T>): Promise<T> {
    const quota = await this.notificationQuota.recordAndCheck(pluginId);
    const auditBase = { actorRole: 'PLUGIN', action: 'PLUGIN_NOTIFICATION_SEND', resource: 'PLUGIN', resourceId: pluginId, metadata: { ...metadata, channel } };
    if (!quota.allowed) {
      void this.audit.log({ ...auditBase, success: false, errorMessage: `Daily notification quota exceeded (${quota.count}/${quota.limit})` });
      throw new Error(`${pluginId} exceeded its daily notification quota (${quota.limit}/day)`);
    }
    try {
      const result = await send();
      void this.audit.log({ ...auditBase, success: true });
      return result;
    } catch (error) {
      void this.audit.log({ ...auditBase, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async unload(id: string) {
    const loaded = this.loaded.get(id);
    if (!loaded) return;
    const errors: string[] = [];
    // Every cleanup stage is attempted even when an earlier hook fails. Otherwise one faulty
    // plugin hook can leave routes, jobs, subscriptions, or contracts live after an administrator
    // explicitly deactivated it.
    try { await this.jobs.clear(id); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    try { await loaded.cleanup?.(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    try { await loaded.module.deactivate?.(loaded.context); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    for (const dispose of loaded.disposers.reverse()) { try { dispose(); } catch { /* best effort */ } }
    this.extensions.clear(id);
    this.contracts?.clear(id);
    this.loaded.delete(id);
    this.logger.log(`Deactivated ${id}`);
    if (errors.length) throw new Error(`Plugin deactivation cleanup failed: ${errors.join('; ')}`);
  }

  status() { return { safeMode: this.safeMode(), loaded: [...this.loaded.keys()].sort() }; }

  private pluginRoot() {
    return path.resolve(process.env.PLUGIN_DIR || (process.env.NODE_ENV === 'production' ? '/data/plugins' : './plugins-installed'));
  }

  private safeMode() { return process.env.PLUGIN_SAFE_MODE?.trim().toLowerCase() === 'true'; }
}
