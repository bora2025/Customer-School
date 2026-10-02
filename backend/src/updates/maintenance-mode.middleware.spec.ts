import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { MaintenanceModeMiddleware, maintenanceFlagPath } from './maintenance-mode.middleware';

describe('core update maintenance mode', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-maintenance-test-'));
    process.env.UPDATE_STATE_DIR = directory;
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); delete process.env.UPDATE_STATE_DIR; });

  it('allows reads but blocks ordinary writes while the durable flag exists', async () => {
    await fs.writeFile(maintenanceFlagPath(), '{}');
    const middleware = new MaintenanceModeMiddleware();
    const next = jest.fn();
    middleware.use({ method: 'GET', path: '/students' } as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(() => middleware.use({ method: 'POST', path: '/students' } as any, {} as any, next)).toThrow('read-only maintenance mode');
  });

  it('allows the health-gate completion callback to leave maintenance mode', async () => {
    await fs.writeFile(maintenanceFlagPath(), '{}');
    const next = jest.fn();
    new MaintenanceModeMiddleware().use({ method: 'POST', path: '/updates/core/operations/00000000-0000-4000-8000-000000000000/complete' } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});
