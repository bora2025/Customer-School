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
    const executed: string[] = [];
    const client = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('FROM pg_roles WHERE rolname = $1')) return [];
        if (sql.includes('rolsuper')) return [{ superuser: false }];
        if (sql.includes('FROM pg_class')) {
          expect(params[0]).toBe('plugin\\_wattanam\\_test\\_%');
          return [{ name: 'plugin_wattanam_test_notes', kind: 'r' }, { name: 'plugin_wattanam_test_seq', kind: 'S' }];
        }
        return [];
      }),
      $executeRawUnsafe: jest.fn(async (sql: string) => { executed.push(sql); return 0; }),
    };
    await expect(ensurePluginDatabaseRole(client as any, 'wattanam.test')).resolves.toEqual({ role: 'wtp_wattanam_test', relations: 2 });
    expect(executed).toEqual([
      'CREATE ROLE "wtp_wattanam_test" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
      // Non-superuser host: attributes are verified (not re-asserted), then membership is granted.
      'GRANT "wtp_wattanam_test" TO CURRENT_USER',
      'GRANT USAGE ON SCHEMA public TO "wtp_wattanam_test"',
      'REVOKE CREATE ON SCHEMA public FROM "wtp_wattanam_test"',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."plugin_wattanam_test_notes" TO "wtp_wattanam_test"',
      'GRANT USAGE, SELECT, UPDATE ON SEQUENCE public."plugin_wattanam_test_seq" TO "wtp_wattanam_test"',
    ]);
  });

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
