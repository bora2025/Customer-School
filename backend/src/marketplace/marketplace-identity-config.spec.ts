import { readMarketplaceIdentityConfig } from './marketplace-identity-config';

describe('marketplace identity configuration', () => {
  it('is disabled unless MARKETPLACE_URL is set', () => {
    expect(readMarketplaceIdentityConfig({ NODE_ENV: 'production' })).toBeNull();
  });

  it('requires HTTPS in production', () => {
    expect(() => readMarketplaceIdentityConfig({ NODE_ENV: 'production', MARKETPLACE_URL: 'http://marketplace.example.com' })).toThrow('HTTPS');
  });

  it('requires INSTALLATION_KEY_DIR to be absolute in production', () => {
    expect(() => readMarketplaceIdentityConfig({
      NODE_ENV: 'production', MARKETPLACE_URL: 'https://marketplace.example.com', INSTALLATION_KEY_DIR: 'relative/path',
    })).toThrow('absolute path');
  });

  it('loads a valid configuration with sensible defaults', () => {
    const config = readMarketplaceIdentityConfig({ NODE_ENV: 'development', MARKETPLACE_URL: 'https://marketplace.example.com' });
    expect(config).toMatchObject({ marketplaceUrl: 'https://marketplace.example.com', requestTimeoutMs: 10000 });
    expect(config!.installationKeyDir).toContain('marketplace-identity');
  });

  it('rejects a URL with a path or query', () => {
    expect(() => readMarketplaceIdentityConfig({ MARKETPLACE_URL: 'https://marketplace.example.com/v1' })).toThrow('without a path');
  });
});
