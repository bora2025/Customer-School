import { ForbiddenException } from '@nestjs/common';

export type PluginExecutionDecision = { mode: 'declarative-only' | 'trusted-in-process'; allowed: boolean; reason: string };

export function inProcessPluginPublishers(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const configured = env.PLUGIN_IN_PROCESS_PUBLISHERS?.split(',').map((value) => value.trim()).filter(Boolean);
  return new Set(configured?.length ? configured : ['wattanam']);
}

/** A signature proves provenance, not confinement. Native Node backend code may execute only for
 * an operator-approved publisher. Declarative UI-only packages execute no backend plugin code. */
export function pluginExecutionDecision(manifest: { publisher: string; backendEntry?: string }, env: NodeJS.ProcessEnv = process.env): PluginExecutionDecision {
  if (!manifest.backendEntry) return { mode: 'declarative-only', allowed: true, reason: 'Plugin has no executable backend entry' };
  const allowed = inProcessPluginPublishers(env).has(manifest.publisher);
  return allowed
    ? { mode: 'trusted-in-process', allowed: true, reason: `Publisher ${manifest.publisher} is trusted for in-process backend execution` }
    : { mode: 'trusted-in-process', allowed: false, reason: `Publisher ${manifest.publisher} is not allowed to execute backend code in the Customer School process` };
}

export function assertPluginExecutionAllowed(manifest: { publisher: string; backendEntry?: string }, env: NodeJS.ProcessEnv = process.env) {
  const decision = pluginExecutionDecision(manifest, env);
  if (!decision.allowed) throw new ForbiddenException(`${decision.reason}; deploy it through a supported isolated plugin runtime or add the publisher to PLUGIN_IN_PROCESS_PUBLISHERS after security review`);
  return decision;
}
