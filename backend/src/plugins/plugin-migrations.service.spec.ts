import { createHash } from 'crypto';
import {
  LEGACY_HEADERLESS_MIGRATIONS,
  LEGACY_MULTI_STATEMENT_MIGRATIONS,
  PluginMigrationsService,
} from './plugin-migrations.service';

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

  it('keeps legacy compatibility immutable without requiring plugin source in the host repository', () => {
    expect([...LEGACY_HEADERLESS_MIGRATIONS.entries()].map(([key, values]) => [key, [...values]])).toEqual([
      ['wattanam.academic-management:003_create_enrollment_interval', ['6a7304a8ea29c064a394144ba0fa4aa9288e62fabe03a9f0a81224401d969861']],
      ['wattanam.academic-management:004_create_study_year', ['54a0a91809e5ad924484776f47c8b7638b6d1894bff379f1485c229f25fb0ac1', '19a750f6164c3f10c13dc9e2f871c54e58db450f983082f028e38d03175554ca']],
      ['wattanam.academic-management:005_create_class', ['9d10a96010801a827f947e0f04a1fedb8a4eb59e3be3b742e51a7e1d53ea9b9c', '79a804f2e8d9d5005c58c30cede604ced6b473baa2cfff5fa3e8879602d1a11b']],
      ['wattanam.academic-management:006_create_class_registration', ['a6eaa58785201a91f2236dbbe777eb7900600e71eb193c9052b99a860f53ce67']],
      ['wattanam.academic-management:007_create_class_registration_settings', ['f7fac966cf3f0d9156898a3a297e7a17747d50a77090af8c85634449a2ba734f']],
      ['wattanam.academic-management:008_create_class_registration_field', ['b550055dd6951c330f7f8fb0719fb2bfef722c0066486c8a3a2f64946caffa18']],
      ['wattanam.attendance-manager:001_create_attendance_manager', ['d02277c13ddbf7b0237f7059fb389f3fef36184edbfb907ff536515ef0b69233']],
    ]);
    expect([...LEGACY_MULTI_STATEMENT_MIGRATIONS.entries()]).toEqual([
      ['wattanam.attendance-manager:001_create_attendance_manager', 'd02277c13ddbf7b0237f7059fb389f3fef36184edbfb907ff536515ef0b69233'],
      ['wattanam.attendance-manager:003_enforce_student_boundary', 'ed92bab5dd405713b6dbbff4a40d40e0d608bb68a97d2733fd8bd084c20eb91c'],
      ['wattanam.attendance-manager:004_add_corrections_scans_alerts_snapshots', '3d1b4733339a53a66c67a511a1ea769abcf8656882d671978261542f2891b682'],
      ['wattanam.attendance-manager:005_add_alert_delivery_ledger', 'd7772013527176050539349faff053af05fe36f08845d12036fd2d977ac14c8d'],
      ['wattanam.attendance-manager:006_add_legacy_adoption_fields', 'fc36b516cf8f3079a5a075527e2219108456a4c7133e9561eb70f41844c821c9'],
    ]);
  });
});
