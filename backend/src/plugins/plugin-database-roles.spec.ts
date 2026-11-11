import { promises as fs } from 'fs';
import path from 'path';
import { PluginEventBus } from './plugin-events';
import { PluginRuntimeService } from './plugin-runtime.service';
import { assertNoForbiddenSql } from './plugin-sql-guard';
import { ensurePluginDatabaseRole, pluginDatabaseRole, pluginDatabaseRolesEnforced } from './plugin-database-roles';

describe('per-plugin database roles', () => {
  it('derives a deterministic role name that always fits a PostgreSQL identifier', () => {
    expect(pluginDatabaseRole('wattanam.academic-management')).toBe('wtp_wattanam_academic_management');
    const long = `vendor.${'x'.repeat(80)}`;
    expect(pluginDatabaseRole(long)).toHaveLength(63);
    expect(pluginDatabaseRole(long)).toBe(pluginDatabaseRole(long));
    expect(pluginDatabaseRole(long)).not.toBe(pluginDatabaseRole(`${long}y`));
  });

  it('is enforced unless an operator explicitly opts out', () => {
    expect(pluginDatabaseRolesEnforced({})).toBe(true);
    expect(pluginDatabaseRolesEnforced({ PLUGIN_DATABASE_ROLES: 'enforce' })).toBe(true);
    expect(pluginDatabaseRolesEnforced({ PLUGIN_DATABASE_ROLES: 'OFF' })).toBe(false);
  });

  it('refuses every statement that could leave the plugin role or borrow another role', () => {
    for (const sql of [
      'RESET ROLE', 'reset all', 'SET ROLE postgres', 'SET LOCAL ROLE postgres', 'SET SESSION ROLE postgres',
      'SET SESSION AUTHORIZATION postgres', "SELECT set_config('role', 'postgres', true) FROM plugin_x_a",
      "SELECT SET_CONFIG ('role','postgres',false)", 'CREATE FUNCTION plugin_x_f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$',
    ]) expect(() => assertNoForbiddenSql(sql, 'probe')).toThrow(/forbidden database operation/);
    // Ordinary statements that merely contain the words keep working.
    for (const sql of ['UPDATE plugin_x_a SET status = $1 WHERE id = $2', "SELECT 'reset' AS label FROM plugin_x_a", 'INSERT INTO plugin_x_a (role) VALUES ($1)']) {
      expect(() => assertNoForbiddenSql(sql, 'probe')).not.toThrow();
    }
  });

  it('creates the role with no powers and grants only the plugin namespace', async () => {
    const { client, executed } = roleClient({ self: { name: 'wattanam_api', superuser: false, createrole: true, version: 180000 }, exists: false, access: { admin: true, usable: false }, peers: ['wattanam_worker'] });
    await expect(ensurePluginDatabaseRole(client as any, 'wattanam.test')).resolves.toEqual({ role: 'wtp_wattanam_test', relations: 2, mode: 'manager' });
    expect(executed).toEqual([
      'CREATE ROLE "wtp_wattanam_test" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
      // Non-superuser manager (the API user): attributes are verified (not re-asserted), then it
      // and the other runtime user (the worker) become members.
      'GRANT "wtp_wattanam_test" TO CURRENT_USER',
      'GRANT "wtp_wattanam_test" TO "wattanam_worker"',
      'GRANT USAGE ON SCHEMA public TO "wtp_wattanam_test"',
      'REVOKE CREATE ON SCHEMA public FROM "wtp_wattanam_test"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."plugin_wattanam_test_notes" TO "wtp_wattanam_test"',
      'GRANT USAGE, SELECT, UPDATE ON SEQUENCE public."plugin_wattanam_test_seq" TO "wtp_wattanam_test"',
    ]);
  });

  it('lets a plain member (the worker) use the role without managing anything', async () => {
    const { client, executed } = roleClient({ self: { name: 'wattanam_worker', superuser: false, createrole: false, version: 180000 }, exists: true, access: { admin: false, usable: true } });
    await expect(ensurePluginDatabaseRole(client as any, 'wattanam.test')).resolves.toEqual({ role: 'wtp_wattanam_test', relations: 0, mode: 'member' });
    expect(executed).toEqual([]);
  });

  it('refuses with an explanation when the user can neither create nor use the role', async () => {
    const worker = { name: 'wattanam_worker', superuser: false, createrole: false, version: 180000 };
    await expect(ensurePluginDatabaseRole(roleClient({ self: worker, exists: false }).client as any, 'wattanam.test'))
      .rejects.toThrow(/does not exist and database user wattanam_worker may not create roles/);
    await expect(ensurePluginDatabaseRole(roleClient({ self: worker, exists: true, access: { admin: false, usable: false } }).client as any, 'wattanam.test'))
      .rejects.toThrow(/wattanam_worker is not a member of plugin database role wtp_wattanam_test/);
    await expect(ensurePluginDatabaseRole(roleClient({ self: worker, exists: true, attributes: { rolsuper: true }, access: { admin: false, usable: true } }).client as any, 'wattanam.test'))
      .rejects.toThrow(/unexpected attributes \(rolsuper\)/);
  });

  it('asks PostgreSQL 15 and older about plain membership instead of the SET option', async () => {
    const { client, queries } = roleClient({ self: { name: 'wattanam_worker', superuser: false, createrole: false, version: 150004 }, exists: true, access: { admin: false, usable: true } });
    await ensurePluginDatabaseRole(client as any, 'wattanam.test');
    expect(queries.find((sql) => sql.includes('pg_has_role'))).toMatch(/'MEMBER'\) AS usable/);
  });

  function roleClient(options: { self: Record<string, unknown>; exists: boolean; attributes?: Record<string, boolean>; access?: { admin: boolean; usable: boolean }; peers?: string[] }) {
    const executed: string[] = [];
    const queries: string[] = [];
    const client = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        queries.push(sql);
        if (sql.includes('rolname = current_user') && sql.includes('server_version_num')) return [options.self];
        if (sql.includes('SELECT rolname FROM pg_roles WHERE rolname = $1')) return options.exists ? [{ rolname: params[0] }] : [];
        if (sql.includes('rolreplication')) return [options.attributes || {}];
        if (sql.includes('pg_has_role')) return [options.access || { admin: false, usable: false }];
        if (sql.includes('ANY($1::text[])')) return (options.peers || []).map((rolname) => ({ rolname }));
        if (sql.includes('FROM pg_class')) {
          expect(params[0]).toBe('plugin\\_wattanam\\_test\\_%');
          return [{ name: 'plugin_wattanam_test_notes', kind: 'r' }, { name: 'plugin_wattanam_test_seq', kind: 'S' }];
        }
        return [];
      }),
      $executeRawUnsafe: jest.fn(async (sql: string) => { executed.push(sql); return 0; }),
    };
    return { client, executed, queries };
  }

  describe('runtime', () => {
    const originalEnvironment = process.env;
    let directory: string;
    beforeEach(async () => {
      directory = await fs.mkdtemp(path.join(process.cwd(), '.tmp-wattanam-roles-test-'));
      process.env = { ...originalEnvironment, NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', APP_VERSION: '0.1.0', PLUGIN_DIR: directory, PLUGIN_TRUSTED_KEYS: '{}' };
    });
    afterEach(async () => {
      process.env = originalEnvironment;
      await fs.rm(directory, { recursive: true, force: true });
    });

    async function loadPlugin(source: string, capabilities: string[]) {
      const installedPath = path.join(directory, 'wattanam.test', '1.0.0');
      await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
      await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), source);
      const manifest = { id: 'wattanam.test', version: '1.0.0', publisher: 'wattanam', backendEntry: 'backend/index.js', capabilities, permissions: [], dependencies: {}, contracts: { events: { publishes: { 'wattanam.test.noted': [1] }, subscribes: {} }, readModels: { publishes: {}, reads: {} } } };
      const log: string[] = [];
      const tx = {
        $queryRawUnsafe: jest.fn(async (sql: string) => {
          log.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
          if (sql.includes('rolsuper')) return [{ superuser: true }];
          if (sql.includes('FROM pg_class')) return [{ name: 'plugin_wattanam_test_notes', kind: 'r' }];
          if (sql.includes('FROM pg_roles WHERE rolname')) return [{ rolname: 'wtp_wattanam_test' }];
          return [{ id: 'n1' }];
        }),
        $executeRawUnsafe: jest.fn(async (sql: string) => { log.push(sql.trim().split(/\s+/).slice(0, 4).join(' ')); return 1; }),
      };
      const prisma = {
        pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.test', version: '1.0.0', installedPath }) },
        $transaction: jest.fn(async (work: any) => work(tx)),
      } as any;
      const contracts = { publish: jest.fn(async () => { log.push('HOST publish'); }), clear: jest.fn() };
      const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
      const stub = () => ({ registerRoute: jest.fn(), registerPermissions: jest.fn(), registerNavigation: jest.fn(), clear: jest.fn(), register: jest.fn(), get: jest.fn(), set: jest.fn() });
      const runtime = new PluginRuntimeService(prisma, verifier, new PluginEventBus(), stub() as any, stub() as any, stub() as any, stub() as any, stub() as any, stub() as any, stub() as any, { recordAndCheck: jest.fn() } as any, { log: jest.fn() } as any, undefined, undefined, contracts as any);
      await runtime.load('wattanam.test');
      return log;
    }

    it('provisions the role on load and runs single statements under it', async () => {
      const log = await loadPlugin(`
        module.exports = { id: 'wattanam.test', async activate(context) {
          await context.database.query('SELECT * FROM plugin_wattanam_test_notes WHERE id = $1', ['n1']);
          await context.database.execute('DELETE FROM plugin_wattanam_test_notes WHERE id = $1', ['n1']);
        } };`, ['database.read', 'database.write']);
      const provisioning = log.indexOf('GRANT SELECT, INSERT, UPDATE,');
      const firstPluginSql = log.indexOf('SELECT * FROM plugin_wattanam_test_notes');
      expect(provisioning).toBeGreaterThanOrEqual(0);
      expect(provisioning).toBeLessThan(firstPluginSql);
      expect(log[firstPluginSql - 1]).toBe('SET LOCAL ROLE "wtp_wattanam_test"');
      const write = log.indexOf('DELETE FROM plugin_wattanam_test_notes WHERE');
      expect(log[write - 1]).toBe('SET LOCAL ROLE "wtp_wattanam_test"');
    });

    it('runs every transactional plugin statement under its role, one at a time, and host work as the host', async () => {
      const log = await loadPlugin(`
        module.exports = { id: 'wattanam.test', async activate(context) {
          await context.database.transaction(async (tx) => {
            // Fired without awaiting, interleaved with host work: must still be serialised.
            tx.execute('INSERT INTO plugin_wattanam_test_notes (id) VALUES ($1)', ['a']);
            tx.publish({ event: 'wattanam.test.noted', version: 1, key: 'a', payload: {} });
            tx.query('SELECT * FROM plugin_wattanam_test_notes', []);
          });
        } };`, ['database.read', 'database.write', 'database.transaction', 'events.durable']);
      const insert = log.findIndex((entry) => entry.startsWith('INSERT INTO plugin_wattanam_test_notes'));
      expect(insert).toBeGreaterThan(0);
      const body = log.slice(insert - 1);
      expect(body.slice(0, 7)).toEqual([
        'SET LOCAL ROLE "wtp_wattanam_test"', 'INSERT INTO plugin_wattanam_test_notes (id)', 'SET LOCAL ROLE NONE',
        'HOST publish',
        'SET LOCAL ROLE "wtp_wattanam_test"', 'SELECT * FROM plugin_wattanam_test_notes', 'SET LOCAL ROLE NONE',
      ]);
    });

    it('can be switched off explicitly by the operator', async () => {
      process.env.PLUGIN_DATABASE_ROLES = 'off';
      const log = await loadPlugin(`
        module.exports = { id: 'wattanam.test', async activate(context) {
          await context.database.query('SELECT * FROM plugin_wattanam_test_notes', []);
        } };`, ['database.read']);
      expect(log.some((entry) => entry.startsWith('SET LOCAL ROLE'))).toBe(false);
      expect(log.some((entry) => entry.startsWith('CREATE ROLE') || entry.startsWith('GRANT'))).toBe(false);
    });
  });
});
