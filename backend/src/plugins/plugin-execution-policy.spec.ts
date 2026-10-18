import { assertPluginExecutionAllowed, inProcessPluginPublishers, pluginExecutionDecision } from './plugin-execution-policy';

describe('plugin backend execution policy', () => {
  it('allows declarative-only plugins without granting process execution', () => {
    expect(pluginExecutionDecision({ publisher: 'community' }, {} as NodeJS.ProcessEnv)).toMatchObject({ mode: 'declarative-only', allowed: true });
  });
  it('defaults backend execution to the official publisher only', () => {
    expect(inProcessPluginPublishers({} as NodeJS.ProcessEnv)).toEqual(new Set(['wattanam']));
    expect(pluginExecutionDecision({ publisher: 'wattanam', backendEntry: 'backend/index.js' }, {} as NodeJS.ProcessEnv).allowed).toBe(true);
    expect(() => assertPluginExecutionAllowed({ publisher: 'community', backendEntry: 'backend/index.js' }, {} as NodeJS.ProcessEnv)).toThrow('not allowed to execute backend code');
  });
  it('supports an explicit operator-reviewed publisher allow-list', () => {
    const env = { PLUGIN_IN_PROCESS_PUBLISHERS: 'wattanam,acme-reviewed' } as NodeJS.ProcessEnv;
    expect(pluginExecutionDecision({ publisher: 'acme-reviewed', backendEntry: 'backend/index.js' }, env).allowed).toBe(true);
  });
});
