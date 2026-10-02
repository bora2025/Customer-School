import { InternalServerErrorException } from '@nestjs/common';
import { existsSync, readFileSync, promises as fs } from 'fs';
import path from 'path';
import { TrustedPluginKeys } from './plugin-package';

function pluginDir(): string {
  return path.resolve(process.env.PLUGIN_DIR || (process.env.NODE_ENV === 'production' ? '/data/plugins' : './plugins-installed'));
}

/** Sibling to the plugin install directories, not a plugin itself -- holds publisher keys this
 * installation has dynamically learned from a signed marketplace index (see
 * recordMarketplaceTrustedKey), separate from the operator-configured static allow-list. */
function marketplaceTrustFile(): string {
  return path.join(pluginDir(), '.marketplace-trusted-keys.json');
}

function staticTrustedPluginKeys(): TrustedPluginKeys {
  const keyFile = process.env.PLUGIN_TRUSTED_KEYS_FILE?.trim();
  const source = keyFile && existsSync(keyFile)
    ? readFileSync(keyFile, 'utf8')
    : process.env.PLUGIN_TRUSTED_KEYS || '{}';
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
    return parsed as TrustedPluginKeys;
  } catch (error) {
    throw new InternalServerErrorException(`Trusted plugin key configuration is invalid: ${(error as Error).message}`);
  }
}

async function readMarketplaceTrustedKeys(): Promise<TrustedPluginKeys> {
  try {
    const parsed = JSON.parse(await fs.readFile(marketplaceTrustFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as TrustedPluginKeys) : {};
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

/**
 * Merges the static, operator-configured allow-list with publisher keys this installation has
 * dynamically learned from a signed marketplace index. Without this merge, a plugin bought
 * through the marketplace would install once (via an ephemeral, call-scoped trust extension) but
 * then fail every later re-verification -- activation, or the active-plugin reload every server
 * restart performs -- because those only ever call this function, with no way to pass a one-off
 * extra key in. Persisting the key here keeps it trusted for the plugin's whole lifecycle, not
 * just its first install.
 */
export async function trustedPluginKeys(): Promise<TrustedPluginKeys> {
  const base = staticTrustedPluginKeys();
  const dynamic = await readMarketplaceTrustedKeys();
  const merged: TrustedPluginKeys = { ...base };
  for (const [publisher, keys] of Object.entries(dynamic)) merged[publisher] = { ...(merged[publisher] || {}), ...keys };
  return merged;
}

/** Called once, right after a marketplace-purchased plugin's first install succeeds, so its
 * publisher key survives for future activation/reload -- see trustedPluginKeys() above. */
export async function recordMarketplaceTrustedKey(publisher: string, keyId: string, publicKeyPem: string): Promise<void> {
  const file = marketplaceTrustFile();
  const current = await readMarketplaceTrustedKeys();
  if (current[publisher]?.[keyId] === publicKeyPem) return;
  const next: TrustedPluginKeys = { ...current, [publisher]: { ...(current[publisher] || {}), [keyId]: publicKeyPem } };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.partial`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}
