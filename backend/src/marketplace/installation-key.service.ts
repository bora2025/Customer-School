import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { canonicalJson } from './canonical-json';
import { readMarketplaceIdentityConfig } from './marketplace-identity-config';

interface KeyInfo {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
}

@Injectable()
export class InstallationKeyService {
  private cached: KeyInfo | null = null;
  private pending: Promise<KeyInfo> | null = null;

  async ensureKeyPair(): Promise<KeyInfo> {
    if (this.cached) return this.cached;
    if (!this.pending) {
      this.pending = this.loadOrGenerate().then((info) => { this.cached = info; this.pending = null; return info; });
      this.pending.catch(() => { this.pending = null; });
    }
    return this.pending;
  }

  async sign(payload: Record<string, unknown>): Promise<string> {
    const { privateKeyPem } = await this.ensureKeyPair();
    return sign(null, Buffer.from(canonicalJson(payload)), privateKeyPem).toString('base64');
  }

  async replaceKeyPair(privateKeyPem: string): Promise<KeyInfo> {
    const config = requireConfig();
    await this.persist(config.installationKeyDir, privateKeyPem);
    const info = deriveKeyInfo(privateKeyPem);
    this.cached = info;
    return info;
  }

  private async loadOrGenerate(): Promise<KeyInfo> {
    const config = requireConfig();
    const keyFile = path.join(config.installationKeyDir, 'installation-ed25519.pem');
    let privateKeyPem: string;
    try {
      privateKeyPem = await fs.readFile(keyFile, 'utf8');
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      await this.persist(config.installationKeyDir, privateKeyPem);
    }
    return deriveKeyInfo(privateKeyPem);
  }

  private async persist(keyDir: string, privateKeyPem: string) {
    const keyFile = path.join(keyDir, 'installation-ed25519.pem');
    await fs.mkdir(keyDir, { recursive: true });
    const temporary = `${keyFile}.${process.pid}.${Date.now()}.partial`;
    await fs.writeFile(temporary, privateKeyPem, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, keyFile);
  }
}

function requireConfig() {
  const config = readMarketplaceIdentityConfig();
  if (!config) throw new ServiceUnavailableException('Marketplace integration is not configured (MARKETPLACE_URL is not set)');
  return config;
}

function deriveKeyInfo(privateKeyPem: string): KeyInfo {
  const publicKey = createPublicKey(privateKeyPem);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  return { privateKeyPem, publicKeyPem, fingerprint };
}
