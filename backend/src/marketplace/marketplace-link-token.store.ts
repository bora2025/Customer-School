import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { readMarketplaceIdentityConfig } from './marketplace-identity-config';

const TOKEN_FILE_NAME = 'marketplace-link-session.token';

/** Holds the delegated marketplace session token at rest. Mirrors InstallationKeyService's exact
 * file pattern (0600, atomic write-then-rename) rather than a DB column: this secret is capable
 * of creating paid orders against the linked MarketplaceAccount and deserves the same custody
 * already proven for the installation's own private key, not a new encryption story. */
@Injectable()
export class MarketplaceLinkTokenStore {
  async read(): Promise<string | null> {
    const config = requireConfig();
    try {
      return (await fs.readFile(this.tokenFile(config.installationKeyDir), 'utf8')).trim();
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(token: string): Promise<void> {
    const config = requireConfig();
    const tokenFile = this.tokenFile(config.installationKeyDir);
    await fs.mkdir(config.installationKeyDir, { recursive: true });
    const temporary = `${tokenFile}.${process.pid}.${Date.now()}.partial`;
    await fs.writeFile(temporary, token, { mode: 0o600 });
    await fs.rename(temporary, tokenFile);
  }

  async clear(): Promise<void> {
    const config = requireConfig();
    try {
      await fs.unlink(this.tokenFile(config.installationKeyDir));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  private tokenFile(keyDir: string): string {
    return path.join(keyDir, TOKEN_FILE_NAME);
  }
}

function requireConfig() {
  const config = readMarketplaceIdentityConfig();
  if (!config) throw new ServiceUnavailableException('Marketplace integration is not configured (MARKETPLACE_URL is not set)');
  return config;
}
