import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parsePluginManifest } from './plugin-manifest';

describe('Parent Portal official plugin source', () => {
  const root = path.resolve(process.cwd(), '..', 'plugins', 'wattanam.parent-portal');
  it('declares optional domain adapters and only namespaced workflow storage', () => {
    const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')));
    expect(manifest.id).toBe('wattanam.parent-portal');
    expect(manifest.version).toBe('0.1.3');
    expect(manifest.dependencies).toEqual({});
    expect(Object.keys(manifest.optionalDependencies).sort()).toEqual([
      'wattanam.academic-management', 'wattanam.attendance-manager', 'wattanam.communication',
      'wattanam.examination', 'wattanam.finance', 'wattanam.transportation',
    ]);
    expect(manifest.capabilities).toEqual(expect.arrayContaining(['accounts.parent.resolve', 'accounts.guardian.assign', 'readmodels.read']));
    for (const migration of manifest.migrations) {
      const bytes = fs.readFileSync(path.join(root, migration.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(migration.checksum);
      expect(bytes.toString()).not.toMatch(/REFERENCES\s+("?(User|Student|Attendance|FeeRecord|Exam))/i);
    }
  });

  it('ships declarative child, link and request workspaces', () => {
    const bundle = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'page.json'), 'utf8'));
    expect(bundle.pages.map((page: any) => page.id)).toEqual(['children', 'link', 'requests']);
  });
});
