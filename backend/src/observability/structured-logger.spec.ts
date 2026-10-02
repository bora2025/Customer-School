import { logEvent } from './structured-logger';

describe('structured-logger', () => {
  it('emits one JSON line to stdout for info/warn and redacts known-sensitive keys', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logEvent('info', { correlationId: 'abc', password: 'hunter2', nested: { token: 'raw-token', safe: 'keep-me' } });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed).toMatchObject({ level: 'info', correlationId: 'abc', password: '[REDACTED]', nested: { token: '[REDACTED]', safe: 'keep-me' } });
    expect(typeof parsed.timestamp).toBe('string');
    spy.mockRestore();
  });

  it('routes error-level events to stderr', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logEvent('error', { statusCode: 500 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('redacts sensitive keys inside arrays of objects too', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logEvent('info', { items: [{ secret: 'x' }, { safe: 'y' }] });
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.items).toEqual([{ secret: '[REDACTED]' }, { safe: 'y' }]);
    spy.mockRestore();
  });
});
