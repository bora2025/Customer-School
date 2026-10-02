import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, verify as verifySignature } from 'crypto';
import yauzl from 'yauzl';
import semver from 'semver';
import { PluginManifest, parsePluginManifest } from './plugin-manifest';
import { promises as fs } from 'fs';
import path from 'path';

export interface TrustedPluginKeys {
  [publisher: string]: { [keyId: string]: string };
}

interface ChecksumsFile {
  algorithm: 'sha256';
  files: Record<string, string>;
}

interface SignatureFile {
  algorithm: 'ed25519';
  publisher: string;
  keyId: string;
  signature: string;
}

export interface VerifiedPluginPackage {
  manifest: PluginManifest;
  files: Map<string, Buffer>;
  packageSha256: string;
  publisherKeyId: string;
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function safePackagePath(name: string) {
  return !!name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.split('/').includes('..');
}

function json<T>(buffer: Buffer, name: string): T {
  try { return JSON.parse(buffer.toString('utf8')) as T; }
  catch { throw new BadRequestException(`${name} is not valid JSON`); }
}

@Injectable()
export class PluginPackageVerifier {
  async verify(buffer: Buffer, trustedKeys: TrustedPluginKeys, coreVersion: string): Promise<VerifiedPluginPackage> {
    const maximum = Number(process.env.PLUGIN_MAX_UNPACKED_BYTES || 50 * 1024 * 1024);
    if (!buffer.length || buffer.length > maximum) throw new BadRequestException('Plugin package is empty or exceeds the package limit');
    const files = await this.readZip(buffer, maximum);
    return this.verifyFiles(files, trustedKeys, coreVersion, sha256(buffer));
  }

  async verifyInstalledDirectory(directory: string, trustedKeys: TrustedPluginKeys, coreVersion: string): Promise<VerifiedPluginPackage> {
    const root = path.resolve(directory);
    const maximum = Number(process.env.PLUGIN_MAX_UNPACKED_BYTES || 50 * 1024 * 1024);
    const files = new Map<string, Buffer>();
    let total = 0;
    const visit = async (current: string) => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const stat = await fs.lstat(absolute);
        if (stat.isSymbolicLink()) throw new BadRequestException(`Installed plugin contains a symlink: ${entry.name}`);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          if (!safePackagePath(relative)) throw new BadRequestException(`Unsafe installed plugin path: ${relative}`);
          total += stat.size;
          if (total > maximum) throw new BadRequestException('Installed plugin exceeds the unpacked-content limit');
          files.set(relative, await fs.readFile(absolute));
        }
      }
    };
    await visit(root);
    return this.verifyFiles(files, trustedKeys, coreVersion, 'installed-directory');
  }

  private verifyFiles(files: Map<string, Buffer>, trustedKeys: TrustedPluginKeys, coreVersion: string, packageSha256: string): VerifiedPluginPackage {
    for (const required of ['plugin.json', 'checksums.json', 'signature.json']) {
      if (!files.has(required)) throw new BadRequestException(`Plugin package is missing ${required}`);
    }

    const manifest = parsePluginManifest(json(files.get('plugin.json')!, 'plugin.json'));
    if (!semver.valid(coreVersion) || !semver.satisfies(coreVersion, manifest.requiresCore)) {
      throw new BadRequestException(`Plugin ${manifest.version} is incompatible with core ${coreVersion}`);
    }

    const checksums = json<ChecksumsFile>(files.get('checksums.json')!, 'checksums.json');
    if (checksums.algorithm !== 'sha256' || !checksums.files || typeof checksums.files !== 'object') {
      throw new BadRequestException('checksums.json must declare sha256 file checksums');
    }
    const expectedFiles = Object.keys(checksums.files).sort();
    const actualPayloadFiles = [...files.keys()].filter((name) => !['checksums.json', 'signature.json'].includes(name)).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualPayloadFiles)) {
      throw new BadRequestException('Plugin archive contents do not exactly match checksums.json');
    }
    for (const [name, expected] of Object.entries(checksums.files)) {
      if (!/^[a-f0-9]{64}$/.test(expected) || sha256(files.get(name)!) !== expected) {
        throw new BadRequestException(`Checksum verification failed for ${name}`);
      }
    }
    for (const entry of [manifest.backendEntry, manifest.frontendEntry].filter(Boolean) as string[]) {
      if (!files.has(entry)) throw new BadRequestException(`Plugin entry file is missing: ${entry}`);
    }
    for (const migration of manifest.migrations) {
      const content = files.get(migration.path);
      if (!content) throw new BadRequestException(`Plugin migration file is missing: ${migration.path}`);
      if (sha256(content) !== migration.checksum) throw new BadRequestException(`Plugin migration checksum does not match manifest: ${migration.id}`);
    }

    const signature = json<SignatureFile>(files.get('signature.json')!, 'signature.json');
    if (signature.algorithm !== 'ed25519' || signature.publisher !== manifest.publisher) {
      throw new ForbiddenException('Plugin signature metadata does not match its publisher');
    }
    const publicKey = trustedKeys[signature.publisher]?.[signature.keyId];
    if (!publicKey) throw new ForbiddenException(`Publisher key is not trusted: ${signature.publisher}/${signature.keyId}`);
    let valid = false;
    try {
      valid = verifySignature(null, files.get('checksums.json')!, publicKey, Buffer.from(signature.signature, 'base64'));
    } catch {
      valid = false;
    }
    if (!valid) throw new ForbiddenException('Plugin package signature is invalid');

    return { manifest, files, packageSha256, publisherKeyId: signature.keyId };
  }

  private readZip(buffer: Buffer, maximum: number): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
        if (error || !zip) return reject(new BadRequestException(`Invalid plugin ZIP: ${error?.message || 'unknown error'}`));
        const files = new Map<string, Buffer>();
        let total = 0;
        const fail = (cause: unknown) => { zip.close(); reject(cause); };
        zip.on('error', (cause) => fail(new BadRequestException(`Invalid plugin ZIP: ${cause.message}`)));
        zip.on('end', () => resolve(files));
        zip.on('entry', (entry) => {
          if (!safePackagePath(entry.fileName)) return fail(new BadRequestException(`Unsafe plugin path: ${entry.fileName}`));
          if (/\/$/.test(entry.fileName)) return zip.readEntry();
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((mode & 0o170000) === 0o120000) return fail(new BadRequestException(`Plugin symlinks are not allowed: ${entry.fileName}`));
          if (files.has(entry.fileName)) return fail(new BadRequestException(`Duplicate plugin path: ${entry.fileName}`));
          total += entry.uncompressedSize;
          if (total > maximum) return fail(new BadRequestException('Plugin unpacked content exceeds the package limit'));
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail(new BadRequestException(`Cannot read plugin entry: ${entry.fileName}`));
            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', fail);
            stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
          });
        });
        zip.readEntry();
      });
    });
  }
}
