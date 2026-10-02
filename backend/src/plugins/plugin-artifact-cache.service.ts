import { BadGatewayException, Injectable } from '@nestjs/common';
import { createHash, sign } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../database/prisma.service';
import { canonicalJson } from '../marketplace/canonical-json';
import { readMarketplaceIdentityConfig } from '../marketplace/marketplace-identity-config';
import { readRuntimeConfig } from '../config/environment';
import { trustedPluginKeys } from './plugin-config';
import { PluginPackageVerifier, VerifiedPluginPackage } from './plugin-package';

type RegistryArtifact = { id: string; version: string; packageSha256: string; installedPath: string };

/**
 * A process-local, read-only cache backed by the marketplace artifact origin.
 * API and worker services deliberately run this code independently: no Railway
 * volume sharing is assumed. A registry row is never enough to load code.
 */
@Injectable()
export class PluginArtifactCacheService {
  constructor(private readonly prisma: PrismaService, private readonly verifier: PluginPackageVerifier) {}

  async ensure(record: RegistryArtifact): Promise<{ directory: string; verified: VerifiedPluginPackage; cacheHit: boolean }> {
    const cacheFile = this.cacheFile(record.packageSha256);
    let bytes: Buffer;
    let cacheHit = true;
    try { bytes = await fs.readFile(cacheFile); }
    catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      cacheHit = false;
      bytes = await this.download(record.packageSha256);
      await this.putCreateOnly(cacheFile, bytes, record.packageSha256);
    }
    this.assertDigest(bytes, record.packageSha256);
    const verified = await this.verifier.verify(bytes, await trustedPluginKeys(), readRuntimeConfig().appVersion);
    if (verified.manifest.id !== record.id || verified.manifest.version !== record.version) throw new Error('Cached artifact identity does not match plugin registry');
    await this.materialize(record, verified);
    return { directory: path.resolve(record.installedPath), verified, cacheHit };
  }

  async seed(bytes: Buffer, sha256: string) {
    await this.putCreateOnly(this.cacheFile(sha256), bytes, sha256);
  }

  async retain(record: RegistryArtifact) {
    const source = this.cacheFile(record.packageSha256);
    const destination = path.join(this.cacheRoot(), 'recovery', `${record.packageSha256}.wtp`);
    const bytes = await fs.readFile(source);
    await this.putCreateOnly(destination, bytes, record.packageSha256);
    return destination;
  }

  private async materialize(record: RegistryArtifact, verified: VerifiedPluginPackage) {
    const destination = path.resolve(record.installedPath);
    try {
      const existing = await this.verifier.verifyInstalledDirectory(destination, await trustedPluginKeys(), readRuntimeConfig().appVersion);
      if (existing.manifest.id === record.id && existing.manifest.version === record.version) return;
    } catch { /* missing or damaged cache is rebuilt from the verified archive */ }
    const root = path.resolve(readRuntimeConfig().pluginDir);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Plugin registry path is outside PLUGIN_DIR');
    const staging = path.join(root, '.staging', `${record.id}-${record.packageSha256}-${process.pid}`);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true, mode: 0o750 });
    try {
      for (const [name, content] of verified.files) {
        const target = path.resolve(staging, name);
        if (!target.startsWith(`${path.resolve(staging)}${path.sep}`)) throw new Error(`Unsafe cached artifact path: ${name}`);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
        await fs.writeFile(target, content, { mode: 0o640 });
      }
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(staging, destination);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async download(sha256: string) {
    const config = readMarketplaceIdentityConfig();
    if (!config) throw new BadGatewayException('Artifact cache miss while marketplace integration is unavailable');
    const url = new URL(`/v1/artifacts/${sha256}`, config.marketplaceUrl);
    let response = await this.fetch(url, config.requestTimeoutMs);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { installationId: true } });
      if (!installation) throw new BadGatewayException('Artifact download requires a registered installation');
      const ts = String(Math.floor(Date.now() / 1000));
      const keyFile = path.join(config.installationKeyDir, 'installation-ed25519.pem');
      const signature = sign(null, Buffer.from(canonicalJson({ installationId: installation.installationId, sha256, ts })), await fs.readFile(keyFile, 'utf8')).toString('base64');
      url.searchParams.set('installationId', installation.installationId); url.searchParams.set('ts', ts); url.searchParams.set('signature', signature);
      response = await this.fetch(url, config.requestTimeoutMs);
    }
    if (!response.ok) throw new BadGatewayException(`Artifact origin returned ${response.status}`);
    const maximum = readRuntimeConfig().pluginMaxPackageBytes;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maximum) throw new BadGatewayException('Artifact exceeds the configured package limit');
    const chunks: Buffer[] = []; let total = 0;
    if (!response.body) throw new BadGatewayException('Artifact origin returned an empty body');
    for await (const chunk of response.body as any) {
      const value = Buffer.from(chunk); total += value.length;
      if (total > maximum) throw new BadGatewayException('Artifact exceeds the configured package limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private fetch(url: URL, timeoutMs: number) {
    return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/vnd.wattanam.plugin+zip' } });
  }

  private async putCreateOnly(destination: string, bytes: Buffer, sha256: string) {
    this.assertDigest(bytes, sha256);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
    try { await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o440 }); }
    catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      this.assertDigest(await fs.readFile(destination), sha256);
    }
  }

  private assertDigest(bytes: Buffer, sha256: string) {
    if (!/^[a-f0-9]{64}$/.test(sha256) || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Artifact cache digest mismatch');
  }

  private cacheFile(sha256: string) { return path.join(this.cacheRoot(), 'sha256', sha256.slice(0, 2), `${sha256}.wtp`); }
  private cacheRoot() { return path.join(path.resolve(readRuntimeConfig().pluginDir), '.artifact-cache'); }
}
