import { createHash } from 'node:crypto';

/**
 * The exact payload a school signs when it tells the marketplace it paid. It must stay identical to
 * schoolPaymentSignedPayload in apps/marketplace-api/src/installation-entitlement-access.service.ts,
 * or every submission fails verification -- the marketplace's school-payment-from-school live drill
 * signs with this function and verifies with that one to catch any drift.
 *
 * The receipt is covered by its SHA-256 rather than inline: that binds the image just as firmly
 * without canonicalising a couple of hundred kilobytes into the signed bytes. Every field signs as a
 * string, so the two apps' canonical-JSON implementations cannot disagree about nulls or numbers.
 */
export function schoolPaymentSignedPayload(installationId: string, ts: string, body: Record<string, unknown>) {
  const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));
  return {
    purpose: 'school-payment-submission', installationId, ts,
    invoiceId: text(body.invoiceId), provider: text(body.provider), providerReference: text(body.providerReference),
    amountMinor: text(body.amountMinor), paymentMethodId: text(body.paymentMethodId), note: text(body.note),
    submittedBy: text(body.submittedBy),
    receiptSha256: typeof body.receiptImage === 'string' ? createHash('sha256').update(body.receiptImage).digest('hex') : '',
  };
}
