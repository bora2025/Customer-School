import fs from 'node:fs';
import path from 'node:path';
import { localModulesForDistribution } from '../app.module';
import { ROOT_MODULE_REGISTRY, rootModuleNamesForDistribution, rootModulesByClassification } from './module-registry';

describe('root module registry', () => {
  it('classifies every local module imported by AppModule exactly once', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.module.ts'), 'utf8');
    const imported = [...source.matchAll(/import \{ (\w+Module) \} from '(\.\/[^']+\.module)'/g)]
      .map((match) => ({ module: match[1], importPath: match[2] }))
      .sort((a, b) => a.module.localeCompare(b.module));
    const registered = ROOT_MODULE_REGISTRY
      .map(({ module, importPath }) => ({ module, importPath }))
      .sort((a, b) => a.module.localeCompare(b.module));

    expect(registered).toEqual(imported);
    expect(new Set(ROOT_MODULE_REGISTRY.map((entry) => entry.module)).size).toBe(ROOT_MODULE_REGISTRY.length);
    expect(new Set(ROOT_MODULE_REGISTRY.map((entry) => entry.importPath)).size).toBe(ROOT_MODULE_REGISTRY.length);
  });

  it('uses only the four accepted classifications and never labels business ownership as core', () => {
    expect(ROOT_MODULE_REGISTRY).toHaveLength(37);
    expect(rootModulesByClassification('core')).toHaveLength(12);
    expect(rootModulesByClassification('shared')).toHaveLength(2);
    expect(rootModulesByClassification('proxy')).toHaveLength(1);
    expect(rootModulesByClassification('business')).toHaveLength(22);
    expect(ROOT_MODULE_REGISTRY.filter((entry) => entry.classification === 'business' && entry.owner === 'lean-core')).toEqual([]);
  });

  it('selects only core/shared roots for core and every root for legacy-full', () => {
    const core = rootModuleNamesForDistribution('core');
    const legacy = rootModuleNamesForDistribution('legacy-full');

    expect(core).toHaveLength(14);
    expect(legacy).toHaveLength(37);
    expect(core).toEqual(ROOT_MODULE_REGISTRY.filter((entry) => ['core', 'shared'].includes(entry.classification)).map((entry) => entry.module));
    expect(legacy).toEqual(ROOT_MODULE_REGISTRY.map((entry) => entry.module));
    expect(core).not.toContain('AttendanceModule');
    expect(core).not.toContain('AnnouncementsModule');
    expect(localModulesForDistribution('core').map((module) => module.name)).toEqual(core);
    expect(localModulesForDistribution('legacy-full').map((module) => module.name)).toEqual(legacy);
  });

  it('keeps business scheduled work and gateways outside core composition', () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const files = fs.readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' } as any)
      .map((entry: any) => String(entry).replace(/\\/g, '/'))
      .filter((entry: string) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'));
    const runtimeItems = files.flatMap((file: string) => {
      const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
      const jobs = [...source.matchAll(/^\s*@(Cron|Interval|Timeout)\s*\(/gm)].map(() => ({ file, kind: 'job' }));
      const gateways = [...source.matchAll(/^\s*@WebSocketGateway\s*\(/gm)].map(() => ({ file, kind: 'gateway' }));
      return [...jobs, ...gateways];
    });
    const coreNames = new Set(rootModuleNamesForDistribution('core'));

    const classified = runtimeItems.map((item) => {
      const area = item.file.split('/')[0];
      const possibleRoots = ROOT_MODULE_REGISTRY.filter((entry) => entry.importPath.startsWith(`./${area}/`));
      const classifications = new Set(possibleRoots.map((entry) => entry.classification));
      expect(classifications.size).toBe(1);
      const classification = [...classifications][0];
      const selectedInCore = possibleRoots.some((entry) => coreNames.has(entry.module));
      return { ...item, classification, selectedInCore };
    });

    expect(classified.filter((item) => item.kind === 'job')).toHaveLength(7);
    expect(classified.filter((item) => item.kind === 'gateway')).toHaveLength(4);
    expect(classified.filter((item) => item.kind === 'gateway' && item.selectedInCore)).toEqual([
      expect.objectContaining({ file: 'plugins/plugin-realtime.gateway.ts', classification: 'core' }),
    ]);
    expect(classified.filter((item) => item.classification === 'business' && item.selectedInCore)).toEqual([]);
  });
});
