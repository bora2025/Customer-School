import { PrismaClient } from '@prisma/client';
import { enterPluginDatabaseRole, ensurePluginDatabaseRole, leavePluginDatabaseRole } from './plugin-database-roles';

// Real PostgreSQL proof of the per-plugin database boundary. Runs only when
// PLUGIN_ROLES_DATABASE_URL points at a THROWAWAY database whose user is a superuser (as on hosted
// PostgreSQL, where the school API connects as the owner): CI provides one, locally use Docker.
const url = process.env.PLUGIN_ROLES_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('per-plugin database roles on real PostgreSQL', () => {
  let prisma: PrismaClient;
  const denied = /permission denied|must be superuser|not allowed|insufficient privilege/i;

  /** Runs `sql` as the plugin inside its own transaction, like the runtime does. */
  async function asPlugin(pluginId: string, sql: string) {
    return prisma.$transaction(async (tx) => {
      await enterPluginDatabaseRole(tx, pluginId);
      return tx.$queryRawUnsafe(sql);
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const [{ superuser }] = await prisma.$queryRawUnsafe<Array<{ superuser: boolean }>>('SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user');
    if (!superuser) throw new Error('PLUGIN_ROLES_DATABASE_URL must use a superuser on a throwaway database');
    const tables = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>("SELECT count(*) AS count FROM pg_tables WHERE schemaname = 'public'");
    if (Number(tables[0].count) !== 0) throw new Error('PLUGIN_ROLES_DATABASE_URL must be an empty throwaway database');
    for (const sql of [
      'CREATE TABLE "User" (id text PRIMARY KEY, email text, "passwordHash" text)',
      "INSERT INTO \"User\" VALUES ('u1', 'owner@school.example', 'secret-hash')",
      'CREATE TABLE plugin_wattanam_demo_notes (id text PRIMARY KEY, body text)',
      "INSERT INTO plugin_wattanam_demo_notes VALUES ('n1', 'hello')",
      'CREATE TABLE plugin_wattanam_other_secrets (id text PRIMARY KEY, value text)',
      "INSERT INTO plugin_wattanam_other_secrets VALUES ('s1', 'other plugin data')",
    ]) await prisma.$executeRawUnsafe(sql);
    await prisma.$transaction((tx) => ensurePluginDatabaseRole(tx, 'wattanam.demo'));
    await prisma.$transaction((tx) => ensurePluginDatabaseRole(tx, 'wattanam.other'));
  });

  afterAll(async () => { await prisma?.$disconnect(); });

  it('lets a plugin read and write its own tables', async () => {
    await expect(asPlugin('wattanam.demo', 'SELECT body FROM plugin_wattanam_demo_notes')).resolves.toEqual([{ body: 'hello' }]);
    await prisma.$transaction(async (tx) => {
      await enterPluginDatabaseRole(tx, 'wattanam.demo');
      await tx.$executeRawUnsafe("INSERT INTO plugin_wattanam_demo_notes VALUES ('n2', 'written by plugin')");
      await tx.$executeRawUnsafe("UPDATE plugin_wattanam_demo_notes SET body = 'edited' WHERE id = 'n2'");
      await tx.$executeRawUnsafe("DELETE FROM plugin_wattanam_demo_notes WHERE id = 'n2'");
    });
  });

  it.each([
    ['a comma join into core users', 'SELECT u.email FROM plugin_wattanam_demo_notes n, "User" u'],
    ['a subquery into core users', 'SELECT (SELECT "passwordHash" FROM "User" LIMIT 1) FROM plugin_wattanam_demo_notes'],
    ['DELETE ... USING core users', 'DELETE FROM plugin_wattanam_demo_notes USING "User" u WHERE true RETURNING u.email'],
    ['UPDATE ... FROM core users', 'UPDATE plugin_wattanam_demo_notes SET body = u.email FROM "User" u RETURNING body'],
    ['another plugin\'s tables', 'SELECT value FROM plugin_wattanam_other_secrets'],
    ['dynamic SQL via query_to_xml', 'SELECT query_to_xml(\'SELECT * FROM "User"\', true, false, \'\') FROM plugin_wattanam_demo_notes'],
    ['reading server files', "SELECT pg_read_file('/etc/passwd') FROM plugin_wattanam_demo_notes"],
    ['creating tables', 'CREATE TABLE plugin_wattanam_demo_extra (id int)'],
  ])('refuses %s', async (_name, sql) => {
    await expect(asPlugin('wattanam.demo', sql)).rejects.toThrow(denied);
  });

  it('confines the role to the transaction: host work after COMMIT runs as the host again', async () => {
    await asPlugin('wattanam.demo', 'SELECT 1 FROM plugin_wattanam_demo_notes');
    const [{ user }] = await prisma.$queryRawUnsafe<Array<{ user: string }>>('SELECT current_user AS user');
    expect(user).not.toBe('wtp_wattanam_demo');
    await expect(prisma.$queryRawUnsafe('SELECT email FROM "User"')).resolves.toHaveLength(1);
  });

  it('returns to the host role inside a transaction for host writes', async () => {
    await prisma.$transaction(async (tx) => {
      await enterPluginDatabaseRole(tx, 'wattanam.demo');
      await leavePluginDatabaseRole(tx);
      await expect(tx.$queryRawUnsafe('SELECT email FROM "User"')).resolves.toHaveLength(1);
    });
  });

  it('shows why the SQL guard must refuse set_config: at the database level it would escape the role', async () => {
    // Documented as a known escape that only the guard (plugin-sql-guard.ts) closes.
    const rows = await asPlugin('wattanam.demo', "SELECT set_config('role', 'none', true) AS r");
    expect(rows).toEqual([{ r: 'none' }]);
  });

  it('gives the role no attributes and no grants outside its namespace', async () => {
    const [role] = await prisma.$queryRawUnsafe<Array<Record<string, boolean>>>(
      "SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'wtp_wattanam_demo'");
    expect(role).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false, rolbypassrls: false, rolinherit: false });
    const grants = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT DISTINCT table_name FROM information_schema.role_table_grants WHERE grantee = 'wtp_wattanam_demo' ORDER BY 1");
    expect(grants.map((grant) => grant.table_name)).toEqual(['plugin_wattanam_demo_notes']);
  });

  it('picks up tables created by later migrations on the next reconcile', async () => {
    await prisma.$executeRawUnsafe('CREATE TABLE plugin_wattanam_demo_added_later (id text PRIMARY KEY)');
    await expect(asPlugin('wattanam.demo', 'SELECT * FROM plugin_wattanam_demo_added_later')).rejects.toThrow(denied);
    await prisma.$transaction((tx) => ensurePluginDatabaseRole(tx, 'wattanam.demo'));
    await expect(asPlugin('wattanam.demo', 'SELECT * FROM plugin_wattanam_demo_added_later')).resolves.toEqual([]);
  });

  it('also works when the host connects as a hardened non-superuser role with CREATEROLE', async () => {
    await prisma.$executeRawUnsafe('CREATE ROLE wattanam_api_probe NOLOGIN CREATEROLE');
    await prisma.$executeRawUnsafe('GRANT SELECT ON "User" TO wattanam_api_probe');
    await prisma.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON plugin_wattanam_demo_notes TO wattanam_api_probe WITH GRANT OPTION');
    await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wattanam_api_probe WITH GRANT OPTION');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE wattanam_api_probe');
      await ensurePluginDatabaseRole(tx, 'wattanam.probe');
    });
    const [membership] = await prisma.$queryRawUnsafe<Array<{ member: boolean }>>("SELECT pg_has_role('wattanam_api_probe', 'wtp_wattanam_probe', 'SET') AS member");
    expect(membership.member).toBe(true);
  });
});
