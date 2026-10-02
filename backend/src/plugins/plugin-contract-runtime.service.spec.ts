import { PluginContractRuntimeService } from './plugin-contract-runtime.service';

describe('PluginContractRuntimeService', () => {
  const original = process.env;
  beforeEach(() => { process.env = { ...original, NODE_ENV: 'test', PROCESS_ROLE: 'api' }; });
  afterEach(() => { process.env = original; });

  it('writes a namespaced event into the caller transaction with an idempotency key', async () => {
    const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) } as any;
    const service = new PluginContractRuntimeService({} as any);
    await service.publish(tx, 'wattanam.fees', { event: 'wattanam.fees.invoice-created', version: 1, subjectKey: 'student:1', payload: { amount: 10 }, idempotencyKey: 'invoice:1' });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), 'wattanam.fees', 'wattanam.fees.invoice-created', 1, 'student:1', '{"amount":10}', 'invoice:1');
    await expect(service.publish(tx, 'wattanam.fees', { event: 'wattanam.attendance.changed', version: 1, subjectKey: 'x', payload: {}, idempotencyKey: 'bad' })).rejects.toThrow('invalid');
  });

  it('delivers at least once but applies each event once per consumer', async () => {
    const row = { id: '00000000-0000-0000-0000-000000000001', pluginId: 'wattanam.fees', eventName: 'wattanam.fees.invoice-created', schemaVersion: 1, subjectKey: 'student:1', payloadJson: '{"amount":10}', createdAt: new Date(), attempts: 0 };
    let first = true;
    const tx = { $executeRawUnsafe: jest.fn(async (sql: string) => sql.includes('PluginProcessedEvent') ? (first ? (first = false, 1) : 0) : 1) };
    let dispatchTransactions = 0;
    const prisma = {
      $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (work: any) => {
        if (dispatchTransactions++ % 2 === 0) return [row];
        return work(tx);
      }),
    } as any;
    const service = new PluginContractRuntimeService(prisma);
    const handler = jest.fn();
    service.subscribe('wattanam.reporting', { id: 'fees', event: row.eventName, versions: [1], handler });
    await service.dispatch(); await service.dispatch();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("status = 'delivered'"), row.id);
  });

  it('retries with backoff and dead-letters after the bounded attempt count', async () => {
    process.env.PLUGIN_EVENT_MAX_ATTEMPTS = '2';
    const row = { id: '00000000-0000-0000-0000-000000000002', pluginId: 'wattanam.fees', eventName: 'wattanam.fees.failed', schemaVersion: 1, subjectKey: 'invoice:1', payloadJson: '{}', createdAt: new Date(), attempts: 1 };
    const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
    let calls = 0;
    const prisma = { $executeRawUnsafe: jest.fn(), $transaction: jest.fn(async (work: any) => calls++ === 0 ? [row] : work(tx)) } as any;
    const service = new PluginContractRuntimeService(prisma);
    service.subscribe('wattanam.reporting', { id: 'failure', event: row.eventName, versions: [1], handler: () => { throw new Error('broken'); } });
    await service.dispatch();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('PluginDeadLetter'), row.id, 'wattanam.reporting', 'failure', 'broken');
  });

  it('publishes and reads bounded versioned read models', async () => {
    const prisma = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ recordKey: 'student:1', schemaVersion: 2, dataJson: '{"name":"A"}', updatedAt: new Date(0) }]),
    } as any;
    const service = new PluginContractRuntimeService(prisma);
    await service.putReadModel('wattanam.students', 'directory', 2, 'student:1', { name: 'A' });
    await expect(service.readModel('wattanam.students', 'directory', [2])).resolves.toEqual([{ key: 'student:1', version: 2, data: { name: 'A' }, updatedAt: new Date(0) }]);
    await service.readModel('wattanam.students', 'directory', [2], 'student:1');
    expect(prisma.$queryRawUnsafe).toHaveBeenLastCalledWith(expect.stringContaining('"recordKey"=$4'), 'wattanam.students', 'directory', [2], 'student:1');
    await service.readModel('wattanam.students', 'directory', [2], ['student:1', 'student:2', 'student:1']);
    expect(prisma.$queryRawUnsafe).toHaveBeenLastCalledWith(expect.stringContaining('ANY($4::text[])'), 'wattanam.students', 'directory', [2], ['student:1', 'student:2']);
    await expect(service.readModel('wattanam.students', 'directory', [2], '')).rejects.toThrow('invalid');
    await expect(service.readModel('wattanam.students', 'directory', [2], [])).rejects.toThrow('invalid');
    await expect(service.readModel('wattanam.students', 'directory', [2], Array.from({ length: 501 }, (_, index) => `student:${index}`))).rejects.toThrow('invalid');
  });

  it('reports dead-letter health and requeues an operator-approved replay', async () => {
    const dead = { id: '00000000-0000-0000-0000-000000000010', eventId: '00000000-0000-0000-0000-000000000011', consumerId: 'fees', error: 'broken', failedAt: new Date(0) };
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ eventId: dead.eventId }]), $executeRawUnsafe: jest.fn() };
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([dead]), $transaction: jest.fn(async (work) => work(tx)) } as any;
    const service = new PluginContractRuntimeService(prisma);
    await expect(service.health('wattanam.reporting')).resolves.toMatchObject({ status: 'degraded', deadLetterCount: 1 });
    await expect(service.replay('wattanam.reporting', dead.id)).resolves.toEqual({ id: dead.id, status: 'requeued' });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("status='pending'"), dead.eventId);
  });
});
