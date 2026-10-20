import { InternalServerErrorException } from '@nestjs/common';
import { existsSync, readFileSync, promises as fs } from 'fs';
import path from 'path';
import { REVOKED_PLUGIN_KEY, type TrustedPluginKeys } from './plugin-package';

const HOST_TRUST_PLUGIN_ID = '__wattanam_host_marketplace_trust__';
const HOST_REVOKED_KEYS_PLUGIN_ID = '__wattanam_host_revoked_publisher_keys__';
type TrustStore = {
  pluginSetting: {
    findMany(args: unknown): Promise<Array<{ valueJson: string }>>;
    upsert(args: unknown): Promise<unknown>;
  };
};

function pluginDir(): string {
  return path.resolve(process.env.PLUGIN_DIR || (process.env.NODE_ENV === 'production' ? '/data/plugins' : './plugins-installed'));
}

/** Compatibility copy for combined/older installations. Split runtimes use PluginSetting as the
 * shared source of truth because API and worker volumes are deliberately independent. */
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

/** Emergency deny-list applied after every trust merge, including the one-release marketplace
 * trust extension. Format: ["publisher:key-id"] or {"publisher":["key-id"]}. */
export function revokedPluginKeys(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const source = env.PLUGIN_REVOKED_PUBLISHER_KEYS_JSON?.trim() || '[]';
  try {
    const parsed = JSON.parse(source);
    const entries: string[] = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed || {}).flatMap(([publisher, keyIds]) => {
          if (!Array.isArray(keyIds)) throw new Error(`expected an array for ${publisher}`);
          return keyIds.map((keyId) => `${publisher}:${keyId}`);
        });
    const revoked = new Set<string>();
    for (const entry of entries) {
      if (typeof entry !== 'string' || !/^[a-zA-Z0-9._-]{1,100}:[a-zA-Z0-9._-]{1,100}$/.test(entry)) {
        throw new Error(`invalid publisher:keyId entry ${String(entry)}`);
      }
      revoked.add(entry);
    }
    return revoked;
  } catch (error) {
    throw new InternalServerErrorException(`Revoked plugin key configuration is invalid: ${(error as Error).message}`);
  }
}

export function applyPluginKeyRevocations(keys: TrustedPluginKeys, env: NodeJS.ProcessEnv = process.env): TrustedPluginKeys {
  const result: TrustedPluginKeys = {};
  for (const [publisher, publisherKeys] of Object.entries(keys)) result[publisher] = { ...publisherKeys };
  for (const entry of revokedPluginKeys(env)) {
    const separator = entry.indexOf(':');
    const publisher = entry.slice(0, separator);
    const keyId = entry.slice(separator + 1);
    result[publisher] = { ...(result[publisher] || {}), [keyId]: REVOKED_PLUGIN_KEY };
  }
  return result;
}

async function readDatabaseRevokedKeys(store?: TrustStore): Promise<Set<string>> {
  if (!store?.pluginSetting) return new Set();
  const rows = await store.pluginSetting.findMany({ where: { pluginId: HOST_REVOKED_KEYS_PLUGIN_ID }, select: { valueJson: true } });
  const revoked = new Set<string>();
  for (const row of rows) {
    let value: unknown; try { value = JSON.parse(row.valueJson); } catch { throw new InternalServerErrorException('Marketplace publisher revocation record is invalid'); }
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,100}:[a-zA-Z0-9._-]{1,100}$/.test(value)) throw new InternalServerErrorException('Marketplace publisher revocation record is invalid');
    revoked.add(value);
  }
  return revoked;
}

export async function recordMarketplaceRevokedKeys(entries: unknown, store?: TrustStore): Promise<number> {
  if (!Array.isArray(entries)) throw new InternalServerErrorException('Marketplace publisher revocation list is invalid');
  const parsed = revokedPluginKeys({ PLUGIN_REVOKED_PUBLISHER_KEYS_JSON: JSON.stringify(entries) } as NodeJS.ProcessEnv);
  if (!store?.pluginSetting) return parsed.size;
  for (const entry of parsed) await store.pluginSetting.upsert({
    where: { pluginId_key: { pluginId: HOST_REVOKED_KEYS_PLUGIN_ID, key: entry } },
    create: { pluginId: HOST_REVOKED_KEYS_PLUGIN_ID, key: entry, valueJson: JSON.stringify(entry) },
    update: { valueJson: JSON.stringify(entry) },
  });
  return parsed.size;
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

async function readDatabaseTrustedKeys(store?: TrustStore): Promise<TrustedPluginKeys> {
  if (!store?.pluginSetting) return {};
  const rows = await store.pluginSetting.findMany({ where: { pluginId: HOST_TRUST_PLUGIN_ID }, select: { valueJson: true } });
  const keys: TrustedPluginKeys = {};
  for (const row of rows) {
    let value: any;
    try { value = JSON.parse(row.valueJson); } catch { throw new InternalServerErrorException('Marketplace publisher trust record is invalid'); }
    if (!value || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.publisher) || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.keyId) || typeof value.publicKeyPem !== 'string' || !value.publicKeyPem.includes('PUBLIC KEY')) {
      throw new InternalServerErrorException('Marketplace publisher trust record is invalid');
    }
    keys[value.publisher] = { ...(keys[value.publisher] || {}), [value.keyId]: value.publicKeyPem };
  }
  return keys;
}

function assertTrustKey(publisher: string, keyId: string, publicKeyPem: string) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(publisher) || !/^[a-zA-Z0-9._-]{1,100}$/.test(keyId) || typeof publicKeyPem !== 'string' || !publicKeyPem.includes('PUBLIC KEY')) {
    throw new InternalServerErrorException('Marketplace publisher trust key is invalid');
  }
}

async function writeDatabaseTrustedKey(store: TrustStore | undefined, publisher: string, keyId: string, publicKeyPem: string) {
  if (!store?.pluginSetting) return;
  await store.pluginSetting.upsert({
    where: { pluginId_key: { pluginId: HOST_TRUST_PLUGIN_ID, key: `${publisher}:${keyId}` } },
    create: { pluginId: HOST_TRUST_PLUGIN_ID, key: `${publisher}:${keyId}`, valueJson: JSON.stringify({ publisher, keyId, publicKeyPem }) },
    update: { valueJson: JSON.stringify({ publisher, keyId, publicKeyPem }) },
  });
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
export async function trustedPluginKeys(store?: TrustStore): Promise<TrustedPluginKeys> {
  const base = staticTrustedPluginKeys();
  const fileKeys = await readMarketplaceTrustedKeys();
  const databaseKeys = await readDatabaseTrustedKeys(store);
  // One-time, idempotent adoption for installations upgraded from the former single-volume file
  // store. The API sees the old file and publishes it to PostgreSQL; workers then converge without
  // sharing the installation identity volume.
  for (const [publisher, keys] of Object.entries(fileKeys)) {
    for (const [keyId, publicKeyPem] of Object.entries(keys)) {
      assertTrustKey(publisher, keyId, publicKeyPem);
      if (!databaseKeys[publisher]?.[keyId]) await writeDatabaseTrustedKey(store, publisher, keyId, publicKeyPem);
    }
  }
  const merged: TrustedPluginKeys = { ...base };
  for (const dynamic of [fileKeys, databaseKeys]) {
    for (const [publisher, keys] of Object.entries(dynamic)) merged[publisher] = { ...(merged[publisher] || {}), ...keys };
  }
  const databaseRevocations = await readDatabaseRevokedKeys(store);
  const configured = applyPluginKeyRevocations(merged);
  for (const entry of databaseRevocations) {
    const [publisher, keyId] = entry.split(':');
    configured[publisher] = { ...(configured[publisher] || {}), [keyId]: REVOKED_PLUGIN_KEY };
  }
  return configured;
}

/** Called once after marketplace installation. The database copy is authoritative across runtime
 * roles; the filesystem copy keeps existing combined deployments and recovery sets compatible. */
export async function recordMarketplaceTrustedKey(publisher: string, keyId: string, publicKeyPem: string, store?: TrustStore): Promise<void> {
  assertTrustKey(publisher, keyId, publicKeyPem);
  if (revokedPluginKeys().has(`${publisher}:${keyId}`)) {
    throw new InternalServerErrorException(`Marketplace publisher key is revoked: ${publisher}/${keyId}`);
  }
  await writeDatabaseTrustedKey(store, publisher, keyId, publicKeyPem);
  const file = marketplaceTrustFile();
  const current = await readMarketplaceTrustedKeys();
  if (current[publisher]?.[keyId] === publicKeyPem) return;
  const next: TrustedPluginKeys = { ...current, [publisher]: { ...(current[publisher] || {}), [keyId]: publicKeyPem } };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.partial`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}
