import { readRuntimeConfig, RuntimeConfig } from './environment';

/** Validate the complete API environment before Nest creates the application or opens a port. */
export function readApiStartupConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = readRuntimeConfig(env);
  if (config.processRole === 'worker') {
    throw new Error('PROCESS_ROLE=worker must start dist/worker instead of dist/main');
  }
  return config;
}

/** Validate the complete worker environment before Nest creates its application context. */
export function readWorkerStartupConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = readRuntimeConfig(env);
  if (config.processRole !== 'worker') {
    throw new Error('Worker entrypoint requires PROCESS_ROLE=worker');
  }
  return config;
}

