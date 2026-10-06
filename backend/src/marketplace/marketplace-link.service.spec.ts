import { marketplaceApprovalUrl, MarketplaceLinkService } from './marketplace-link.service';

const REQUEST_ID = '3684fa6c-dfe8-449e-ae55-88f7631f7da4';

function prismaDouble(pending: { requestId: string } | null = null) {
  return {
    installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'school-public-id' }) },
    marketplacePendingLink: {
      findUnique: jest.fn().mockResolvedValue(pending),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: pending ? 1 : 0 }),
    },
    marketplaceProxyLink: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  } as any;
}

const keys = { sign: jest.fn().mockResolvedValue('signature') } as any;
const tokenStore = { write: jest.fn().mockResolvedValue(undefined) } as any;

function respond(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('MarketplaceLinkService pending link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MARKETPLACE_URL = 'http://marketplace.test';
    process.env.INSTALLATION_KEY_DIR = './marketplace-identity';
  });
  afterEach(() => jest.restoreAllMocks());

  it('records the request before returning it, so a reload cannot strand an approval', async () => {
    const prisma = prismaDouble();
    respond(201, { requestId: REQUEST_ID, approvalUrl: `http://marketplace.test/marketplace/link/${REQUEST_ID}`, expiresAt: '2099-01-01T00:00:00.000Z' });

    await new MarketplaceLinkService(prisma, keys, tokenStore).start('Bora School');

    expect(prisma.marketplacePendingLink.upsert.mock.calls[0][0].create).toMatchObject({ id: 'singleton', requestId: REQUEST_ID });
  });

  it('rejects approval pages outside the configured marketplace origin', () => {
    expect(() => marketplaceApprovalUrl('https://marketplace.example', REQUEST_ID, `https://evil.example/marketplace/link/${REQUEST_ID}`)).toThrow('untrusted');
    expect(() => marketplaceApprovalUrl('https://marketplace.example', REQUEST_ID, `https://marketplace.example/marketplace/link/${REQUEST_ID}?token=leak`)).toThrow('untrusted');
  });

  it('accepts only the exact marketplace approval route', () => {
    expect(marketplaceApprovalUrl('https://marketplace.example', REQUEST_ID, `https://marketplace.example/marketplace/link/${REQUEST_ID}`))
      .toBe(`https://marketplace.example/marketplace/link/${REQUEST_ID}`);
  });

  it('resumes the recorded request when polled without one', async () => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    const fetchMock = respond(200, {
      sessionToken: 'token', expiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-1', accountEmail: 'owner@example.com', scope: 'catalog:browse', grantId: 'grant-1',
    });

    const result = await new MarketplaceLinkService(prisma, keys, tokenStore).poll();

    expect(result).toMatchObject({ status: 'linked' });
    expect(String(fetchMock.mock.calls[0][0])).toContain(REQUEST_ID);
    // Spent, so a later resume reports the link rather than "already exchanged".
    expect(prisma.marketplacePendingLink.deleteMany).toHaveBeenCalled();
  });

  it('refuses to poll when nothing is awaiting approval', async () => {
    const prisma = prismaDouble(null);
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(new MarketplaceLinkService(prisma, keys, tokenStore).poll()).rejects.toThrow('No marketplace link is awaiting approval');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps waiting, and keeps the record, while the owner has not answered', async () => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    respond(202, {});

    await expect(new MarketplaceLinkService(prisma, keys, tokenStore).poll()).resolves.toEqual({ status: 'pending' });
    expect(prisma.marketplacePendingLink.deleteMany).not.toHaveBeenCalled();
  });

  it('accepts the current marketplace HTTP 200 pending response without writing a token', async () => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    respond(200, { status: 'pending' });

    await expect(new MarketplaceLinkService(prisma, keys, tokenStore).poll()).resolves.toEqual({ status: 'pending' });
    expect(tokenStore.write).not.toHaveBeenCalled();
    expect(prisma.marketplacePendingLink.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed completed response before writing link state', async () => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    respond(200, { status: 'DELIVERED', accountId: 'account-1' });

    await expect(new MarketplaceLinkService(prisma, keys, tokenStore).poll()).rejects.toThrow('invalid completed link response');
    expect(tokenStore.write).not.toHaveBeenCalled();
    expect(prisma.marketplaceProxyLink.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'denied'],
    [410, 'expired'],
  ])('clears the record on a final answer (%s)', async (status, expected) => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    respond(status, { error: expected });

    await expect(new MarketplaceLinkService(prisma, keys, tokenStore).poll()).resolves.toEqual({ status: expected });
    expect(prisma.marketplacePendingLink.deleteMany).toHaveBeenCalled();
  });

  it('reports a waiting request in status so the panel can offer to finish it', async () => {
    const prisma = prismaDouble({ requestId: REQUEST_ID });
    prisma.marketplacePendingLink.findUnique.mockResolvedValue({
      requestId: REQUEST_ID, startedAt: new Date('2026-09-09T04:06:34.000Z'), expiresAt: new Date('2026-09-09T04:21:34.000Z'),
    });

    const status = await new MarketplaceLinkService(prisma, keys, tokenStore).status();

    expect(status).toMatchObject({ linked: false, pending: { requestId: REQUEST_ID, approvalUrl: `http://marketplace.test/marketplace/link/${REQUEST_ID}` } });
  });
});
