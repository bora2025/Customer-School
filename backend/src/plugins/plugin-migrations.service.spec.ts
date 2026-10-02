import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';

const sql = Buffer.from('-- wattanam-plugin-migration: 001\nCREATE TABLE "plugin_wattanam_test_records" ("id" TEXT PRIMARY KEY);');
const checksum = createHash('sha256').update(sql).digest('hex');
const verified: any = {
  manifest: { id: 'wattanam.test', version: '1.0.0', migrations: [{ id: '001', path: 'migrations/001.sql', checksum, destructive: false }] },
  files: new Map([['migrations/001.sql', sql]]),
};

describe('PluginMigrationsService', () => {
  it('executes and records a new immutable namespaced migration', async () => {
    const tx = { pluginMigration: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) }, $executeRawUnsafe: jest.fn().mockResolvedValue(0) } as any;
    await new PluginMigrationsService().apply(tx, verified);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(sql.toString());
    expect(tx.pluginMigration.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pluginId: 'wattanam.test', migrationId: '001', checksum }) });
  });

  it('skips an already applied identical migration and rejects changed history', async () => {
    const service = new PluginMigrationsService();
    const tx = { pluginMigration: { findUnique: jest.fn().mockResolvedValue({ checksum }), create: jest.fn() }, $executeRawUnsafe: jest.fn() } as any;
    await service.apply(tx, verified);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    tx.pluginMigration.findUnique.mockResolvedValue({ checksum: 'a'.repeat(64) });
    await expect(service.apply(tx, verified)).rejects.toThrow('immutable');
  });

  it('rejects access to core tables, transaction control, and undeclared destructive SQL', () => {
    const service = new PluginMigrationsService();
    const manifest: any = { id: 'wattanam.test' };
    expect(() => service.validateSql(manifest, '001', '-- wattanam-plugin-migration: 001\nDROP TABLE "User";', true)).toThrow('only access');
    expect(() => service.validateSql(manifest, '001', '-- wattanam-plugin-migration: 001\nBEGIN;')).toThrow('forbidden');
    expect(() => service.validateSql(manifest, '001', '-- wattanam-plugin-migration: 001\nDROP TABLE "plugin_wattanam_test_records";')).toThrow('undeclared destructive');
  });

  it('accepts only the checksum-pinned legacy Academic Management migrations without headers', () => {
    const service = new PluginMigrationsService();
    const legacySql = 'CREATE TABLE "plugin_wattanam_academic_management_enrollment_interval" ("id" TEXT PRIMARY KEY, "studentId" TEXT NOT NULL, "classId" TEXT NOT NULL, "validFrom" DATE NOT NULL, "validTo" DATE, "source" TEXT NOT NULL DEFAULT \'legacy-adoption\', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "currentStudentId" TEXT GENERATED ALWAYS AS (CASE WHEN "validTo" IS NULL THEN "studentId" ELSE NULL END) STORED, CONSTRAINT "academic_enrollment_valid_range" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom"), CONSTRAINT "academic_enrollment_natural_key" UNIQUE ("studentId", "classId", "validFrom"), CONSTRAINT "academic_enrollment_one_current" UNIQUE ("currentStudentId"));\n';
    const legacyChecksum = createHash('sha256').update(legacySql).digest('hex');
    expect(legacyChecksum).toBe('6a7304a8ea29c064a394144ba0fa4aa9288e62fabe03a9f0a81224401d969861');
    const manifest: any = {
      id: 'wattanam.academic-management',
      migrations: [{ id: '003_create_enrollment_interval', checksum: legacyChecksum }],
    };

    expect(() => service.validateSql(manifest, '003_create_enrollment_interval', legacySql)).not.toThrow();
    expect(() => service.validateSql(manifest, '003_create_enrollment_interval', `${legacySql} `)).toThrow('identity header');
    expect(() => service.validateSql({ ...manifest, id: 'wattanam.other' }, '003_create_enrollment_interval', legacySql)).toThrow('identity header');
    expect(() => service.validateSql({ ...manifest, migrations: [{ id: '003_create_enrollment_interval', checksum: 'a'.repeat(64) }] }, '003_create_enrollment_interval', legacySql)).toThrow('identity header');
  });

  it('accepts both exact certified Academic compatibility migrations without broadening the exception', () => {
    const service = new PluginMigrationsService();
    const pluginRoot = path.resolve(__dirname, '../../../plugins/wattanam.academic-management');
    const manifest: any = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
    for (const migrationId of ['004_create_study_year', '005_create_class']) {
      const migration = manifest.migrations.find((item: { id: string }) => item.id === migrationId);
      const migrationSql = readFileSync(path.join(pluginRoot, migration.path), 'utf8');
      expect(() => service.validateSql(manifest, migrationId, migrationSql)).not.toThrow();
      expect(() => service.validateSql(manifest, migrationId, `${migrationSql} `)).toThrow('identity header');
    }
  });

  it('preserves the exact published Attendance Manager multi-statement migration only', () => {
    const service = new PluginMigrationsService();
    const migrationId = '001_create_attendance_manager';
    const migrationPath = path.resolve(__dirname, '../../../plugins/wattanam.attendance-manager/migrations/001_create_attendance_manager.sql');
    const legacySql = readFileSync(migrationPath, 'utf8');
    const checksum = createHash('sha256').update(legacySql).digest('hex');
    expect(checksum).toBe('d02277c13ddbf7b0237f7059fb389f3fef36184edbfb907ff536515ef0b69233');
    const manifest: any = { id: 'wattanam.attendance-manager', migrations: [{ id: migrationId, checksum }] };

    expect(() => service.validateSql(manifest, migrationId, legacySql)).not.toThrow();
    expect(() => service.validateSql(manifest, migrationId, legacySql.replace('CREATE TABLE', 'CREATE  TABLE'))).toThrow('identity header');
    expect(() => service.validateSql({ ...manifest, id: 'wattanam.other' }, migrationId, legacySql)).toThrow('identity header');
  });

  it('installs the checksum-pinned Attendance migration atomically as individual statements', async () => {
    const migrationId = '001_create_attendance_manager';
    const migrationPath = path.resolve(__dirname, '../../../plugins/wattanam.attendance-manager/migrations/001_create_attendance_manager.sql');
    const content = readFileSync(migrationPath);
    const checksum = createHash('sha256').update(content).digest('hex');
    const attendancePackage: any = {
      manifest: {
        id: 'wattanam.attendance-manager', version: '0.1.2',
        migrations: [{ id: migrationId, path: 'migrations/001_create_attendance_manager.sql', checksum, destructive: false }],
      },
      files: new Map([['migrations/001_create_attendance_manager.sql', content]]),
    };
    const tx = { pluginMigration: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) }, $executeRawUnsafe: jest.fn().mockResolvedValue(0) } as any;

    await new PluginMigrationsService().apply(tx, attendancePackage);

    expect(tx.$executeRawUnsafe.mock.calls.length).toBeGreaterThan(1);
    expect(tx.$executeRawUnsafe.mock.calls.every(([statement]: [string]) => statement.trim().endsWith(';'))).toBe(true);
    expect(tx.pluginMigration.create).toHaveBeenCalledTimes(1);
    expect(tx.pluginMigration.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pluginId: 'wattanam.attendance-manager', migrationId, checksum }) });
  });

  it('installs every exact published Attendance multi-statement migration and rejects modified bytes', async () => {
    const ids = [
      '003_enforce_student_boundary',
      '004_add_corrections_scans_alerts_snapshots',
      '005_add_alert_delivery_ledger',
      '006_add_legacy_adoption_fields',
    ];
    const migrations = ids.map((id) => {
      const migrationPath = path.resolve(__dirname, `../../../plugins/wattanam.attendance-manager/migrations/${id}.sql`);
      const content = readFileSync(migrationPath);
      return { id, path: `migrations/${id}.sql`, checksum: createHash('sha256').update(content).digest('hex'), destructive: false, content };
    });
    const service = new PluginMigrationsService();
    for (const migration of migrations) {
      const manifest: any = { id: 'wattanam.attendance-manager', version: '0.1.6', migrations: [{ ...migration, content: undefined }] };
      expect(() => service.validateSql(manifest, migration.id, migration.content.toString(), false)).not.toThrow();
      expect(() => service.validateSql(manifest, migration.id, `${migration.content.toString()} `, false)).toThrow('exactly one SQL statement');
      expect(() => service.validateSql({ ...manifest, id: 'wattanam.other' }, migration.id, migration.content.toString(), false)).toThrow('exactly one SQL statement');
    }

    const attendancePackage: any = {
      manifest: { id: 'wattanam.attendance-manager', version: '0.1.6', migrations: migrations.map(({ content, ...migration }) => migration) },
      files: new Map(migrations.map((migration) => [migration.path, migration.content])),
    };
    const tx = { pluginMigration: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) }, $executeRawUnsafe: jest.fn().mockResolvedValue(0) } as any;
    await service.apply(tx, attendancePackage);
    expect(tx.$executeRawUnsafe.mock.calls.length).toBeGreaterThan(migrations.length);
    expect(tx.pluginMigration.create).toHaveBeenCalledTimes(migrations.length);
  });

  it('accepts the new single-statement Attendance branding migration through normal validation', () => {
    const migrationId = '002_add_study_year_branding';
    const migrationPath = path.resolve(__dirname, '../../../plugins/wattanam.attendance-manager/migrations/002_add_study_year_branding.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const manifest: any = { id: 'wattanam.attendance-manager', migrations: [{ id: migrationId, checksum }] };

    expect(() => new PluginMigrationsService().validateSql(manifest, migrationId, sql)).not.toThrow();
  });
});
