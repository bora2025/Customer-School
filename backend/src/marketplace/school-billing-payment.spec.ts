jest.mock('./marketplace-identity-config', () => ({
  readMarketplaceIdentityConfig: () => ({ marketplaceUrl: 'https://marketplace.example', requestTimeoutMs: 5000 }),
}));

import { createHash } from 'node:crypto';
import { SchoolBillingControlService } from './school-billing-control.service';
import { schoolPaymentSignedPayload } from './school-payment-signing';

/**
 * Reporting a payment from the school's own admin panel. The school backend signs it with the
 * installation key and forwards it, so an administrator needs no marketplace account.
 */
describe('SchoolBillingControlService submitting a payment from the school', () => {
  const INSTALLATION = '11111111-1111-4111-8111-111111111111';
  const input = {
    invoiceId: '55555555-5555-4555-8555-555555555555', paymentMethodId: '44444444-4444-4444-8444-444444444444',
    amountMinor: 5000, providerReference: '  ABA-778812 ', receiptImage: 'data:image/png;base64,iVBORw0KGgo=',
  };
  const admin = { userId: 'user-1', role: 'SUPER_ADMIN' };

  function harness(reply: { status: number; body: unknown } | Error) {
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: INSTALLATION }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Sokha' }) },
    } as any;
    const keys = { sign: jest.fn().mockResolvedValue('signature-b64') } as any;
    const service = new SchoolBillingControlService(prisma, keys);
    const sync = jest.spyOn(service, 'sync').mockResolvedValue({ configured: true } as any);
    const fetchMock = jest.spyOn(global as any, 'fetch');
    if (reply instanceof Error) fetchMock.mockRejectedValue(reply);
    else fetchMock.mockResolvedValue(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }));
    return { service, keys, sync, fetchMock };
  }
  afterEach(() => jest.restoreAllMocks());

  it('signs every field it sends, the receipt by its hash, and posts to its own installation route', async () => {
    const { service, keys, fetchMock } = harness({ status: 201, body: { id: 'submission-1', status: 'PENDING' } });
    await service.submitPayment(input, admin);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`https://marketplace.example/v1/installations/${INSTALLATION}/school-billing/payment-submissions`);
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ providerReference: 'ABA-778812', provider: 'bank-transfer', submittedBy: 'Sokha (SUPER_ADMIN)', signature: 'signature-b64' });
    const { ts, signature: _signature, ...submission } = sent;
    expect(keys.sign).toHaveBeenCalledWith(schoolPaymentSignedPayload(INSTALLATION, ts, submission));
    expect(keys.sign.mock.calls[0][0].receiptSha256).toBe(createHash('sha256').update(input.receiptImage).digest('hex'));
  });

  // Otherwise the admin sees no sign of the payment until the next hourly sync.
  it('re-syncs so the bill shows the payment as awaiting confirmation straight away', async () => {
    const { service, sync } = harness({ status: 201, body: { id: 'submission-1', status: 'PENDING' } });
    await service.submitPayment(input, admin);
    expect(sync).toHaveBeenCalled();
  });

  it('passes a refusal the school can act on straight through', async () => {
    const { service, sync } = harness({ status: 409, body: { error: 'This payment reference was already submitted' } });
    await expect(service.submitPayment(input, admin)).rejects.toThrow(/already submitted/);
    expect(sync).not.toHaveBeenCalled();
  });

  it('says plainly when the marketplace could not be reached', async () => {
    const { service } = harness(new Error('ECONNREFUSED'));
    await expect(service.submitPayment(input, admin)).rejects.toThrow(/was not submitted/);
  });

  it('asks for the bank reference before signing anything', async () => {
    const { service, keys } = harness({ status: 201, body: {} });
    await expect(service.submitPayment({ ...input, providerReference: ' ' }, admin)).rejects.toThrow(/transaction reference/);
    expect(keys.sign).not.toHaveBeenCalled();
  });

  it('refuses a receipt that is not an image data URL', async () => {
    const { service, keys } = harness({ status: 201, body: {} });
    await expect(service.submitPayment({ ...input, receiptImage: 'data:image/svg+xml;base64,PHN2Zz4=' }, admin)).rejects.toThrow(/PNG, JPEG or WebP/);
    expect(keys.sign).not.toHaveBeenCalled();
  });
});
