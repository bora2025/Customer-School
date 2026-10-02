import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { DualWriteStorageProvider, LocalVolumeStorageProvider, ObjectStorageProvider, S3StorageProvider } from './object-storage';

export type PluginStorageMode = 'local' | 's3' | 'dual-local-primary' | 'dual-s3-primary';

export function createPluginStorageProvider(env: NodeJS.ProcessEnv = process.env): ObjectStorageProvider {
  const mode = (env.PLUGIN_STORAGE_PROVIDER || 'local') as PluginStorageMode;
  if (!['local', 's3', 'dual-local-primary', 'dual-s3-primary'].includes(mode)) throw new Error('PLUGIN_STORAGE_PROVIDER must be local, s3, dual-local-primary, or dual-s3-primary');
  if (env.NODE_ENV === 'production' && ['api', 'worker'].includes(env.PROCESS_ROLE?.trim().toLowerCase() || '') && mode === 'local') {
    throw new Error('PLUGIN_STORAGE_PROVIDER must use shared S3 storage for split API/worker production deployments');
  }
  const localRoot = path.resolve(env.PLUGIN_DATA_DIR || (env.NODE_ENV === 'production' ? '/data/plugin-data' : './plugin-data'));
  const local = new LocalVolumeStorageProvider(localRoot);
  if (mode === 'local') return local;
  const endpoint = env.PLUGIN_STORAGE_S3_ENDPOINT?.trim();
  const bucket = required(env, 'PLUGIN_STORAGE_S3_BUCKET');
  const region = required(env, 'PLUGIN_STORAGE_S3_REGION');
  const accessKeyId = env.PLUGIN_STORAGE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY?.trim();
  if (!!accessKeyId !== !!secretAccessKey) throw new Error('PLUGIN_STORAGE_S3_ACCESS_KEY_ID and PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY must be configured together');
  if (endpoint) {
    const url = new URL(endpoint);
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PLUGIN_STORAGE_S3_ENDPOINT must use HTTPS in production');
  }
  const s3 = new S3StorageProvider(new S3Client({ endpoint, region, forcePathStyle: parseBoolean(env.PLUGIN_STORAGE_S3_FORCE_PATH_STYLE, !!endpoint), credentials: accessKeyId ? { accessKeyId, secretAccessKey: secretAccessKey! } : undefined }), bucket, env.PLUGIN_STORAGE_S3_PREFIX || 'plugin-data');
  if (mode === 's3') return s3;
  return mode === 'dual-local-primary' ? new DualWriteStorageProvider(local, s3) : new DualWriteStorageProvider(s3, local);
}

function required(env: NodeJS.ProcessEnv, name: string) { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function parseBoolean(value: string | undefined, fallback: boolean) { if (!value) return fallback; if (value === 'true') return true; if (value === 'false') return false; throw new Error('PLUGIN_STORAGE_S3_FORCE_PATH_STYLE must be true or false'); }
