import { readApiStartupConfig, readWorkerStartupConfig } from './startup-config';

describe('entrypoint startup configuration', () => {
  const baseEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
  };

  it.each([
    ['API', readApiStartupConfig, { PROCESS_ROLE: 'api' }],
    ['worker', readWorkerStartupConfig, { PROCESS_ROLE: 'worker' }],
  ])('rejects an invalid distribution at %s startup with the supported values', (_name, reader, role) => {
    expect(() => reader({ ...baseEnvironment, ...role, WATTANAM_DISTRIBUTION: 'lean' }))
      .toThrow('WATTANAM_DISTRIBUTION must be core or legacy-full (got "lean")');
  });

  it('returns the selected distribution for both valid entrypoints', () => {
    expect(readApiStartupConfig({
      ...baseEnvironment,
      PROCESS_ROLE: 'api',
      WATTANAM_DISTRIBUTION: 'core',
    }).distribution).toBe('core');
    expect(readWorkerStartupConfig({
      ...baseEnvironment,
      PROCESS_ROLE: 'worker',
      WATTANAM_DISTRIBUTION: 'legacy-full',
    }).distribution).toBe('legacy-full');
  });

  it('keeps entrypoint role failures explicit', () => {
    expect(() => readApiStartupConfig({ ...baseEnvironment, PROCESS_ROLE: 'worker' }))
      .toThrow('PROCESS_ROLE=worker must start dist/worker instead of dist/main');
    expect(() => readWorkerStartupConfig({ ...baseEnvironment, PROCESS_ROLE: 'api' }))
      .toThrow('Worker entrypoint requires PROCESS_ROLE=worker');
  });
});

