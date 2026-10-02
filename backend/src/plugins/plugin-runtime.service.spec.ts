import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DirectoryService } from '../directory/directory.service';
import { PluginEventBus } from './plugin-events';
import { PluginRuntimeService } from './plugin-runtime.service';

describe('PluginRuntimeService', () => {
  const originalEnvironment = process.env;
  let directory: string;
  const dependencies = () => [
    { registerRoute: jest.fn(), registerPermissions: jest.fn(), registerNavigation: jest.fn(), clear: jest.fn() },
    { register: jest.fn(), clear: jest.fn() },
    { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    { readText: jest.fn(), writeText: jest.fn(), delete: jest.fn(), list: jest.fn() },
    { sendEmail: jest.fn().mockResolvedValue({ sent: true }), sendSms: jest.fn().mockResolvedValue({ sent: true }), notifyInApp: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
    {
      resolveAudience: jest.fn().mockResolvedValue([]), lookupUsers: jest.fn().mockResolvedValue([]),
      lookupClasses: jest.fn().mockResolvedValue([]), classesForUser: jest.fn().mockResolvedValue([]),
      lookupSubjects: jest.fn().mockResolvedValue([]),
      getClassRoster: jest.fn().mockResolvedValue({ contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' }, classId: 'class-1', className: 'Grade 1A', asOfIsoDate: '2026-09-25', source: 'plugin-enrollment-interval', students: [] }),
      getEnrollmentAtDate: jest.fn().mockResolvedValue({ contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' }, studentId: 'student-1', classId: 'class-1', className: 'Grade 1A', enrolled: true, asOfIsoDate: '2026-09-25', source: 'plugin-enrollment-interval' }),
    },
    { notifyUser: jest.fn() },
    { recordAndCheck: jest.fn().mockResolvedValue({ allowed: true, count: 1, limit: 200 }) },
    { log: jest.fn().mockResolvedValue(undefined) },
  ] as const;

  beforeEach(async () => {
    // Keep dynamic CommonJS fixtures under Jest's rootDir; Jest refuses to resolve modules from
    // the Windows system temp directory even though production Node accepts the absolute path.
    directory = await fs.mkdtemp(path.join(process.cwd(), '.tmp-wattanam-runtime-test-'));
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/test',
      APP_VERSION: '0.1.0',
      PLUGIN_DIR: directory,
      PLUGIN_TRUSTED_KEYS: '{}',
    };
  });

  afterEach(async () => {
    process.env = originalEnvironment;
    await fs.rm(directory, { recursive: true, force: true });
    delete (global as any).__wattanamPluginActivated;
    delete (global as any).__wattanamPluginCleaned;
  });

  it('loads an authenticated backend lifecycle entry and unloads its cleanup', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        activate(context) {
          global.__wattanamPluginActivated = context.pluginId;
          return () => { global.__wattanamPluginCleaned = true; };
        }
      };
    `);
    const manifest = {
      id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: [], permissions: [], dependencies: {},
    };
    const prisma = {
      pluginInstallation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }),
      },
    } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect((global as any).__wattanamPluginActivated).toBe('wattanam.test');
    await runtime.unload('wattanam.test');
    expect((global as any).__wattanamPluginCleaned).toBe(true);
  });

  it('binds Academic contract dispatch only for the active plugin lifecycle', async () => {
    const installedPath = path.join(directory, 'wattanam.academic-management', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = { id: 'wattanam.academic-management', activate() {} };
    `);
    const manifest = {
      id: 'wattanam.academic-management', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: [], permissions: [], dependencies: {},
    };
    const prisma = {
      pluginInstallation: {
        findUnique: jest.fn().mockResolvedValue({ id: manifest.id, version: manifest.version, installedPath }),
      },
    } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const unbind = jest.fn();
    const unbindIdentity = jest.fn();
    const academicIdentity = { bindAcademicPluginCommands: jest.fn().mockReturnValue(unbindIdentity) };
    (directoryService as any).bindAcademicPluginContracts = jest.fn().mockReturnValue(unbind);
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any, undefined, undefined, undefined, undefined, academicIdentity as any);

    await runtime.load(manifest.id);
    expect((directoryService as any).bindAcademicPluginContracts).toHaveBeenCalledTimes(1);
    const dispatcher = (directoryService as any).bindAcademicPluginContracts.mock.calls[0][0];
    expect(dispatcher.getClassRoster).toEqual(expect.any(Function));
    expect(dispatcher.getEnrollmentAtDate).toEqual(expect.any(Function));
    expect(dispatcher.resolveClassAudience).toEqual(expect.any(Function));
    expect(dispatcher.resolveClassesForUser).toEqual(expect.any(Function));
    expect(dispatcher.lookupClasses).toEqual(expect.any(Function));
    expect(dispatcher.lookupSubjects).toEqual(expect.any(Function));
    expect(dispatcher.departmentForUser).toEqual(expect.any(Function));
    expect(academicIdentity.bindAcademicPluginCommands).toHaveBeenCalledTimes(1);
    expect(academicIdentity.bindAcademicPluginCommands.mock.calls[0][0].assignUserDepartment).toEqual(expect.any(Function));
    expect(academicIdentity.bindAcademicPluginCommands.mock.calls[0][0].assignStudentParent).toEqual(expect.any(Function));
    expect(academicIdentity.bindAcademicPluginCommands.mock.calls[0][0].detachUserAcademicIdentity).toEqual(expect.any(Function));
    expect(academicIdentity.bindAcademicPluginCommands.mock.calls[0][0].attachAcademicProfiles).toEqual(expect.any(Function));

    await runtime.unload(manifest.id);
    expect(unbind).toHaveBeenCalledTimes(1);
    expect(unbindIdentity).toHaveBeenCalledTimes(1);
  });

  it('rejects a registry path outside the configured plugin directory', async () => {
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', installedPath: os.tmpdir() }) } } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, {} as any, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);
    await expect(runtime.load('wattanam.test')).rejects.toThrow('outside PLUGIN_DIR');
  });

  it('delegates a declared notifications.send capability to the core notification service', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          global.__wattanamPluginNotified = await context.notifications.sendEmail('parent@example.com', 'Reminder', 'Body');
        }
      };
    `);
    const manifest = {
      id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: ['notifications.send'], permissions: [], dependencies: {},
    };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect(notifications.sendEmail).toHaveBeenCalledWith('parent@example.com', 'Reminder', 'Body');
    expect((global as any).__wattanamPluginNotified).toEqual({ sent: true });
    delete (global as any).__wattanamPluginNotified;
  });

  it('refuses to send a notification when the plugin did not declare notifications.send', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        activate(context) { return context.notifications.sendEmail('parent@example.com', 'Reminder', 'Body'); }
      };
    `);
    const manifest = { id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: [], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);
    await expect(runtime.load('wattanam.test')).rejects.toThrow('did not declare notifications.send');
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('gates and audits the idempotent core student-account command', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          global.__wattanamPluginStudentAccount = await context.accounts.createStudent({
            commandKey: 'registration:r1', name: 'Student', email: 'student@example.test', passwordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          });
          global.__wattanamPluginStudentAccountUpdated = await context.accounts.updateStudent({
            commandKey: 'csv-update:c1:0001:abc', userId: 'user-1', name: 'Updated Student', email: 'updated@example.test'
          });
        }
      };
    `);
    const manifest = { id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: ['accounts.student.create', 'accounts.student.update'], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const pluginAccounts = {
      createStudent: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Student', role: 'STUDENT', email: 'student@example.test', phone: null }),
      updateStudent: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Updated Student', role: 'STUDENT', email: 'updated@example.test', phone: null }),
    };
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any, undefined, undefined, undefined, undefined, undefined, pluginAccounts as any);

    await runtime.load('wattanam.test');
    expect(pluginAccounts.createStudent).toHaveBeenCalledWith('wattanam.test', expect.objectContaining({ commandKey: 'registration:r1' }));
    expect(pluginAccounts.updateStudent).toHaveBeenCalledWith('wattanam.test', expect.objectContaining({ commandKey: 'csv-update:c1:0001:abc', userId: 'user-1' }));
    expect((global as any).__wattanamPluginStudentAccount).toMatchObject({ id: 'user-1', role: 'STUDENT' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLUGIN_STUDENT_ACCOUNT_CREATE', resourceId: 'user-1', success: true }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLUGIN_STUDENT_ACCOUNT_UPDATE', resourceId: 'user-1', success: true }));
    delete (global as any).__wattanamPluginStudentAccount;
    delete (global as any).__wattanamPluginStudentAccountUpdated;
  });

  it('delegates declared database, directory, and realtime capabilities, namespace-guarding raw SQL', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          global.__wattanamPluginRows = await context.database.query('SELECT * FROM plugin_wattanam_test_notes WHERE id = $1', ['n1']);
          global.__wattanamPluginWrite = await context.database.execute('INSERT INTO plugin_wattanam_test_notes (id) VALUES ($1)', ['n1']);
          global.__wattanamPluginAudience = await context.directory.resolveAudience({ audience: 'SCHOOL' });
          context.realtime.notifyUser('user-1', 'note:new', { id: 'n1' });
          try { await context.database.query('SELECT * FROM "User"', []); } catch (error) { global.__wattanamPluginNamespaceError = error.message; }
        }
      };
    `);
    const manifest = {
      id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: ['database.read', 'database.write', 'directory.read', 'realtime.notify'], permissions: [], dependencies: {},
    };
    const prisma = {
      pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'n1' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT * FROM plugin_wattanam_test_notes WHERE id = $1', 'n1');
    expect((global as any).__wattanamPluginRows).toEqual([{ id: 'n1' }]);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('INSERT INTO plugin_wattanam_test_notes (id) VALUES ($1)', 'n1');
    expect((global as any).__wattanamPluginWrite).toEqual({ count: 1 });
    expect(directoryService.resolveAudience).toHaveBeenCalledWith({ audience: 'SCHOOL' });
    expect(realtime.notifyUser).toHaveBeenCalledWith('wattanam.test', 'user-1', 'note:new', { id: 'n1' });
    expect((global as any).__wattanamPluginNamespaceError).toMatch(/only access tables beginning with plugin_wattanam_test_/);
    delete (global as any).__wattanamPluginRows;
    delete (global as any).__wattanamPluginWrite;
    delete (global as any).__wattanamPluginAudience;
    delete (global as any).__wattanamPluginNamespaceError;
  });

  it('refuses database.execute when the plugin only declared database.read', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        activate(context) { return context.database.execute('DELETE FROM plugin_wattanam_test_notes WHERE id = $1', ['n1']); }
      };
    `);
    const manifest = { id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: ['database.read'], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) }, $executeRawUnsafe: jest.fn() } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);
    await expect(runtime.load('wattanam.test')).rejects.toThrow('did not declare database.write');
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('delegates notifications and versioned Academic directory contracts through capability-gated adapters', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          await context.notifications.notifyInApp('user-1', 'hello', 'announcement');
          await context.directory.lookupUsers(['user-1']);
          await context.directory.lookupClasses(['class-1']);
          await context.directory.classesForUser('user-1', 'TEACHER');
          await context.directory.getClassRoster('class-1', '2026-09-25');
          await context.directory.getEnrollmentAtDate('student-1', '2026-09-25');
        }
      };
    `);
    const manifest = {
      id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: ['notifications.send', 'directory.read'], permissions: [], dependencies: {},
    };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect(notifications.notifyInApp).toHaveBeenCalledWith('user-1', 'hello', 'announcement');
    expect(directoryService.lookupUsers).toHaveBeenCalledWith(['user-1']);
    expect(directoryService.lookupClasses).toHaveBeenCalledWith(['class-1']);
    expect(directoryService.classesForUser).toHaveBeenCalledWith('user-1', 'TEACHER');
    expect(directoryService.getClassRoster).toHaveBeenCalledWith('class-1', '2026-09-25');
    expect(directoryService.getEnrollmentAtDate).toHaveBeenCalledWith('student-1', '2026-09-25');
  });

  it('every notification send is checked against the daily quota and audit-logged, and a denied send never reaches the provider', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          global.__wattanamQuotaError = null;
          try { await context.notifications.sendEmail('a@example.com', 'Subject', 'Text'); }
          catch (error) { global.__wattanamQuotaError = error.message; }
        }
      };
    `);
    const manifest = { id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: ['notifications.send'], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, , audit] = dependencies();
    const notificationQuota = { recordAndCheck: jest.fn().mockResolvedValue({ allowed: false, count: 201, limit: 200 }) };
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect(notificationQuota.recordAndCheck).toHaveBeenCalledWith('wattanam.test');
    expect(notifications.sendEmail).not.toHaveBeenCalled();
    expect((global as any).__wattanamQuotaError).toMatch(/exceeded its daily notification quota/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PLUGIN_NOTIFICATION_SEND', resourceId: 'wattanam.test', success: false,
      errorMessage: expect.stringContaining('quota exceeded'),
    }));
    delete (global as any).__wattanamQuotaError;
  });

  it('a successful notification send is audit-logged with the channel and recipient metadata', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) { await context.notifications.sendSms('+85512345678', 'Body'); }
      };
    `);
    const manifest = { id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: ['notifications.send'], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, directoryService, realtime, notificationQuota, audit] = dependencies();
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');
    expect(notifications.sendSms).toHaveBeenCalledWith('+85512345678', 'Body');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PLUGIN_NOTIFICATION_SEND', resourceId: 'wattanam.test', success: true,
      metadata: expect.objectContaining({ channel: 'sms', to: '+85512345678' }),
    }));
  });

  it('dependent plugin path resolves class lookups through provider-backed DirectoryService', async () => {
    const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = {
        id: 'wattanam.test',
        async activate(context) {
          global.__wattanamDependentClasses = await context.directory.lookupClasses(['class-1']);
          global.__wattanamDependentMembership = await context.directory.classesForUser('user-1', 'TEACHER');
        }
      };
    `);
    const manifest = {
      id: 'wattanam.test', version: '1.0.0', backendEntry: 'backend/index.js',
      capabilities: ['directory.read'], permissions: [], dependencies: {},
    };
    const prisma = {
      pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) },
      class: { findMany: jest.fn() },
      student: { findUnique: jest.fn(), findMany: jest.fn() },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const provider = {
      resolveClassAudience: jest.fn().mockResolvedValue([]),
      lookupClasses: jest.fn().mockResolvedValue([{ id: 'class-1', name: 'Grade 1A' }]),
      resolveClassesForUser: jest.fn().mockResolvedValue(['class-1']),
    } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const [extensions, jobs, settings, storage, notifications, , realtime, notificationQuota, audit] = dependencies();
    const directoryService = new DirectoryService(prisma, provider);
    const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), extensions as any, jobs as any, settings as any, storage as any, notifications as any, directoryService as any, realtime as any, notificationQuota as any, audit as any);

    await runtime.load('wattanam.test');

    expect(provider.lookupClasses).toHaveBeenCalledWith(['class-1']);
    expect(provider.resolveClassesForUser).toHaveBeenCalledWith('user-1', 'TEACHER');
    expect(prisma.class.findMany).not.toHaveBeenCalled();
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
    expect((global as any).__wattanamDependentClasses).toEqual([{ id: 'class-1', name: 'Grade 1A' }]);
    expect((global as any).__wattanamDependentMembership).toEqual(['class-1']);
    delete (global as any).__wattanamDependentClasses;
    delete (global as any).__wattanamDependentMembership;
  });
});
