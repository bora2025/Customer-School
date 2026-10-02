import { getCorsOrigins, getCorsOriginsForGateway, getDistribution, getProcessRole, parseCorsOrigins, parseJwtSecondarySecrets, readRuntimeConfig, runsBackgroundJobs } from './environment';

describe('runtime environment', () => {
  const baseEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
  };

  it('loads safe development defaults', () => {
    const config = readRuntimeConfig(baseEnvironment);

    expect(config.port).toBe(3001);
    expect(config.nodeEnv).toBe('test');
    expect(config.databaseUrl).toBe(baseEnvironment.DATABASE_URL);
    expect(config.cookieSecure).toBe(false);
    expect(config.backupRetentionDays).toBe(30);
    expect(config.pluginMaxPackageBytes).toBe(50 * 1024 * 1024);
    expect(config.processRole).toBe('combined');
    expect(config.workerPort).toBe(3002);
    expect(config.distribution).toBe('legacy-full');
  });

  it('rejects an insecure production JWT secret', () => {
    expect(() => readRuntimeConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://school.example.com',
      JWT_SECRET: 'secret',
    })).toThrow('JWT_SECRET');
  });

  it('requires explicit production CORS origins', () => {
    expect(() => readRuntimeConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      JWT_SECRET: 'a-unique-production-secret-with-more-than-32-characters',
    })).toThrow('CORS_ORIGINS');
  });

  /* The gateway variant exists because @WebSocketGateway decorators run while the module graph
   * loads, before either entry point's bootstrap() reaches readRuntimeConfig(). If it threw there,
   * a missing CORS_ORIGINS would be reported from inside an unrelated feature module. */
  it('does not throw from a gateway decorator when production CORS origins are missing', () => {
    const production = { ...baseEnvironment, NODE_ENV: 'production' };

    expect(() => getCorsOrigins(production)).toThrow('CORS_ORIGINS');
    expect(getCorsOriginsForGateway(production)).toEqual([]);
  });

  it('returns the configured origins to a gateway when they are present', () => {
    const production = {
      ...baseEnvironment,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://school.example.com',
    };

    expect(getCorsOriginsForGateway(production)).toEqual(['https://school.example.com']);
    expect(getCorsOriginsForGateway(baseEnvironment)).toEqual(getCorsOrigins(baseEnvironment));
  });

  it('parses exact HTTP origins', () => {
    expect(parseCorsOrigins('https://school.example.com,http://localhost:3000')).toEqual([
      'https://school.example.com',
      'http://localhost:3000',
    ]);
  });

  it('rejects origins containing paths', () => {
    expect(() => parseCorsOrigins('https://school.example.com/admin')).toThrow('without paths');
  });

  it('rejects malformed boolean and bounded integer settings', () => {
    expect(() => readRuntimeConfig({ ...baseEnvironment, PLUGIN_SAFE_MODE: 'yes' })).toThrow('PLUGIN_SAFE_MODE');
    expect(() => readRuntimeConfig({ ...baseEnvironment, BACKUP_RETENTION_DAYS: '-1' })).toThrow('BACKUP_RETENTION_DAYS');
    expect(() => readRuntimeConfig({ ...baseEnvironment, PLUGIN_MAX_PACKAGE_BYTES: '999999999' })).toThrow('PLUGIN_MAX_PACKAGE_BYTES');
  });

  it('requires persistent production paths to be absolute', () => {
    expect(() => readRuntimeConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      JWT_SECRET: 'a-unique-production-secret-with-more-than-32-characters',
      CORS_ORIGINS: 'https://school.example.com',
      BACKUP_DIR: './backups',
    })).toThrow('BACKUP_DIR');
  });

  it('validates authentication expiry formats', () => {
    expect(() => readRuntimeConfig({ ...baseEnvironment, JWT_ACCESS_EXPIRY: 'two hours' })).toThrow('JWT_ACCESS_EXPIRY');
    expect(() => readRuntimeConfig({ ...baseEnvironment, JWT_REFRESH_EXPIRY: '0' })).toThrow('JWT_REFRESH_EXPIRY');
  });

  it('defaults JWT rotation config to a stable key id and no secondary secrets', () => {
    const config = readRuntimeConfig(baseEnvironment);
    expect(config.jwtKeyId).toBe('jwt-v1');
    expect(config.jwtSecondarySecrets.size).toBe(0);
  });

  it('parses secondary JWT secrets for overlap-capable rotation', () => {
    const map = parseJwtSecondarySecrets(JSON.stringify({ 'jwt-v1': 'old-secret-value' }));
    expect(map.get('jwt-v1')).toBe('old-secret-value');
  });

  it('rejects malformed or wrongly-shaped JWT_SECONDARY_SECRETS_JSON', () => {
    expect(() => parseJwtSecondarySecrets('not json')).toThrow('JWT_SECONDARY_SECRETS_JSON must be valid JSON');
    expect(() => parseJwtSecondarySecrets('["not", "an", "object"]')).toThrow('must be a JSON object');
    expect(() => parseJwtSecondarySecrets(JSON.stringify({ 'bad id!': 'secret' }))).toThrow('key id is invalid');
    expect(() => parseJwtSecondarySecrets(JSON.stringify({ 'jwt-v1': '' }))).toThrow('must be a non-empty string');
  });

  it('validates process roles and background-job ownership', () => {
    expect(getProcessRole({ PROCESS_ROLE: 'api' })).toBe('api');
    expect(runsBackgroundJobs({ PROCESS_ROLE: 'api' })).toBe(false);
    expect(runsBackgroundJobs({ PROCESS_ROLE: 'worker' })).toBe(true);
    expect(runsBackgroundJobs({ PROCESS_ROLE: 'combined' })).toBe(true);
    expect(() => getProcessRole({ PROCESS_ROLE: 'web' })).toThrow('PROCESS_ROLE');
    expect(() => readRuntimeConfig({ ...baseEnvironment, WORKER_PORT: '70000' })).toThrow('PORT');
  });

  /* legacy-full is the default so an upgraded school, which never sets the variable, keeps every
   * module it has (LC2-002). Anything unrecognised stops startup rather than guessing (LC2-007). */
  it('validates the distribution and keeps legacy-full as the default', () => {
    expect(getDistribution({})).toBe('legacy-full');
    expect(getDistribution({ WATTANAM_DISTRIBUTION: '  ' })).toBe('legacy-full');
    expect(getDistribution({ WATTANAM_DISTRIBUTION: 'core' })).toBe('core');
    expect(getDistribution({ WATTANAM_DISTRIBUTION: ' Legacy-Full ' })).toBe('legacy-full');
    expect(() => getDistribution({ WATTANAM_DISTRIBUTION: 'full' })).toThrow('WATTANAM_DISTRIBUTION must be core or legacy-full (got "full")');
    expect(() => readRuntimeConfig({ ...baseEnvironment, WATTANAM_DISTRIBUTION: 'lean' })).toThrow('WATTANAM_DISTRIBUTION');
    expect(readRuntimeConfig({ ...baseEnvironment, WATTANAM_DISTRIBUTION: 'core' }).distribution).toBe('core');
  });
});
