import path from 'path';

export interface MarketplaceIdentityConfig {
  marketplaceUrl: string;
  installationKeyDir: string;
  requestTimeoutMs: number;
}

export function readMarketplaceIdentityConfig(env: NodeJS.ProcessEnv = process.env): MarketplaceIdentityConfig | null {
  const rawUrl = env.MARKETPLACE_URL?.trim();
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MARKETPLACE_URL must be an HTTP(S) origin without a path');
  }
  const nodeEnv = env.NODE_ENV || 'development';
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('MARKETPLACE_URL must use HTTPS in production');
  }
  const installationKeyDir = env.INSTALLATION_KEY_DIR?.trim() || (nodeEnv === 'production' ? '/data/marketplace-identity' : './marketplace-identity');
  if (nodeEnv === 'production' && !installationKeyDir.startsWith('/')) {
    throw new Error('INSTALLATION_KEY_DIR must be an absolute path in production');
  }
  const requestTimeoutMs = boundedInteger(env.MARKETPLACE_REQUEST_TIMEOUT_MS, 10_000, 100, 120_000, 'MARKETPLACE_REQUEST_TIMEOUT_MS');
  return { marketplaceUrl: url.origin, installationKeyDir: path.resolve(installationKeyDir), requestTimeoutMs };
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const value = Number(raw || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}
