'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { imageFileToDataUrl } from '../lib/image-upload';
import { storedRole } from '../lib/school-lock';

type InvoiceLine = { id: string; kind: string; description: string; quantity: number; amountMinor: number };
type SubmissionSummary = { id: string; status: string; providerReference: string; amountMinor: number; createdAt: string; rejectionReason?: string | null };
type Invoice = { id: string; invoiceNumber: string; status: string; currency: string; amountMinor: number; paidMinor: number; description: string; issuedAt: string; dueAt: string; paidAt?: string | null; lines?: InvoiceLine[]; paymentSubmissions?: SubmissionSummary[] };
type Notice = { id: string; subject: string; message: string; createdAt: string; type: string };
/** A Wattanam receiving account, synced from the marketplace with the rest of the bill. */
type PaymentAccount = { id: string; label: string; bankName: string; accountName: string; accountNumber: string; currency: string; qrImage?: string | null; instructions?: string | null };
type BillingState = {
  access: string; reason?: string | null; lastVerifiedAt?: string | null; lastAttemptAt?: string | null; lastError?: string | null;
  /** The stored access is still SUSPENDED, but seven days without a sync have lifted the lock. */
  lockLiftedByOutage?: boolean;
  warnings: Array<{ invoiceId: string; invoiceNumber: string; currency: string; outstandingMinor: number; suspendAt: string }>;
  billing: { schoolName?: string; currency?: string; outstandingMinor?: number; billingPlan?: { name: string; amountMinor: number; currency: string; billingInterval: string }; invoices?: Invoice[]; notifications?: Notice[]; paymentMethods?: PaymentAccount[] };
};

/** How often the panel re-reads this school's synced billing state. Cheap: it is a read of the
 *  school's own database. Reaching the marketplace is still the hourly sync, or Sync now. */
const REFRESH_MS = 60_000;

export function money(amountMinor = 0, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
}

/**
 * The school's platform subscription bill, as last synchronised from the marketplace.
 *
 * Shared by the standalone Platform Billing page and the Licensing page so the two can never show
 * different numbers. The standalone page stays: it is open to ADMIN as well as SUPER_ADMIN, and it
 * is where lib/api.ts sends every 402 while a school is suspended -- Licensing's own requests are
 * blocked in that state, so it cannot be the recovery surface.
 *
 * "Live" means it re-reads every minute and whenever the tab regains focus. A background refresh
 * that fails keeps the last good figures on screen and says they may be stale, rather than
 * replacing a correct balance with an error.
 */
/** The latest payment the school submitted against an invoice, as the reviewer left it. */
function submissionNote(invoice: Invoice) {
  const latest = invoice.paymentSubmissions?.[0];
  if (!latest) return null;
  if (latest.status === 'PENDING') return <div className="text-xs font-medium text-indigo-700">Payment {latest.providerReference} submitted — awaiting confirmation</div>;
  if (latest.status === 'REJECTED') return <div className="text-xs text-red-700">Payment {latest.providerReference} not accepted{latest.rejectionReason ? `: ${latest.rejectionReason}` : ''}</div>;
  return null;
}

export default function PlatformBillingPanel({ variant = 'page' }: { variant?: 'page' | 'section' }) {
  // null = still loading; 'unsynced' = this school has never completed a marketplace sync.
  const [state, setState] = useState<BillingState | 'unsynced' | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const hasState = useRef(false);
  const markedRead = useRef(false);
  // The "tell us you paid" form. Declared here with the other hooks, ahead of the early returns; its
  // defaults come from the loaded bill at render time.
  const [payInvoiceId, setPayInvoiceId] = useState('');
  const [payMethodId, setPayMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payReceipt, setPayReceipt] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payMessage, setPayMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await apiFetch('/api/admin/marketplace/billing-control');
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || `Could not load platform billing (${response.status})`);
    // With no synced row the endpoint returns an empty body. Reading warnings.length off that is
    // what used to crash this view for a school that had not synced yet.
    setState(body && typeof body === 'object' && 'access' in body ? body as BillingState : 'unsynced');
    hasState.current = true; setError(''); setStale(false); setRefreshedAt(new Date());
    // Seeing the notices is what clears the sidebar badge -- once per visit, not every refresh.
    if (!markedRead.current) {
      markedRead.current = true;
      apiFetch('/api/admin/marketplace/billing-control/mark-read', { method: 'POST' }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => load().catch((cause: Error) => {
      if (!active) return;
      if (hasState.current) setStale(true); else setError(cause.message);
    });
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  async function sync() {
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/admin/marketplace/billing-control/sync', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Billing synchronization failed');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Billing synchronization failed'); }
    finally { setBusy(false); }
  }

  const syncButton = <button className={variant === 'section' ? 'btn btn-secondary' : 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'} disabled={busy} onClick={sync}>{busy ? 'Synchronizing…' : 'Sync now'}</button>;
  const freshness = <p className="text-xs text-slate-500">{refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString()} · refreshes every minute` : ''}{stale ? ' · last refresh failed, figures may be out of date' : ''}</p>;

  if (error && !hasState.current) {
    return <Frame variant={variant} actions={syncButton}><div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div></Frame>;
  }
  if (state === null) return <Frame variant={variant} actions={syncButton}><p className="text-sm text-slate-500">Loading billing status…</p></Frame>;
  if (state === 'unsynced') {
    return <Frame variant={variant} actions={syncButton}><p className="text-sm text-slate-600">This school has not synchronised with the marketplace yet, so there is no subscription bill to show. Sync now to fetch it.</p>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</Frame>;
  }

  const invoices = state.billing?.invoices || [];
  const notices = state.billing?.notifications || [];
  const warnings = state.warnings || [];
  const currency = state.billing?.currency || invoices[0]?.currency || 'USD';
  const outstanding = state.billing?.outstandingMinor || 0;
  // "overdue" is derived here: the marketplace keeps an unpaid invoice ISSUED past its due date.
  const isOpen = (invoice: Invoice) => invoice.status !== 'PAID' && invoice.status !== 'VOID' && invoice.amountMinor > invoice.paidMinor;
  const isOverdue = (invoice: Invoice) => isOpen(invoice) && new Date(invoice.dueAt).getTime() < Date.now();
  const nextDue = invoices.filter(isOpen).sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  // The same four tiers as the dashboard banner. Green is kept for "nothing owed": an open bill
  // used to show green "Account active" beside a balance, which reads as paid.
  // The stored access still reads SUSPENDED after seven days without a sync have lifted the lock; the
  // page follows what the school is actually living with, and says why below.
  const locked = state.access === 'SUSPENDED' && !state.lockLiftedByOutage;
  const standing = locked ? 'suspended' : warnings.length ? 'final' : outstanding > 0 ? 'due' : 'clear';
  // Only a billing suspension lifts itself when the invoice is paid. One an operator imposed on the
  // school does not, and telling that school to pay would send it the wrong way.
  const billingSuspension = standing === 'suspended' && warnings.length > 0;
  const tone = { suspended: 'border-red-300 bg-red-50', final: 'border-amber-300 bg-amber-50', due: 'border-indigo-200 bg-indigo-50', clear: 'border-emerald-300 bg-emerald-50' }[standing];
  const title = { suspended: 'School access suspended', final: 'Final payment notice', due: 'Payment due', clear: 'Account active' }[standing];
  const summary = {
    suspended: state.reason || 'School access is suspended.',
    final: 'Pay the overdue balance before the suspension date below, or the school will be locked out.',
    due: nextDue ? `${isOverdue(nextDue) ? 'Overdue since' : 'Next payment due'} ${new Date(nextDue.dueAt).toLocaleDateString()}.` : 'An invoice is open on this subscription.',
    clear: 'Nothing is owed on the platform subscription.',
  }[standing];
  // h2 directly under the standalone page's h1; h3 inside Licensing, under the card's own h2.
  const StatusHeading = variant === 'section' ? 'h3' : 'h2';
  // A school's records stay its own while it is locked, and only the SUPER_ADMIN may take them out --
  // the download route admits nobody else. Read at render time: this only renders after the bill has
  // loaded in the browser, so there is no server render for it to disagree with.
  const canDownloadRecords = standing === 'suspended' && storedRole() === 'SUPER_ADMIN';

  const status = <div className={`rounded-2xl border p-5 ${tone}`}><div className="flex flex-wrap justify-between gap-3"><div><StatusHeading className="font-bold">{title}</StatusHeading><p className="mt-1 text-sm">{summary}</p>{warnings.map(warning => <p key={warning.invoiceId} className="mt-2 text-sm font-semibold">Invoice {warning.invoiceNumber}: {money(warning.outstandingMinor, warning.currency)} outstanding{standing === 'final' ? ` · suspension on ${new Date(warning.suspendAt).toLocaleString()}` : ''}</p>)}{billingSuspension && <p className="mt-3 text-sm">To restore access, pay the balance and tell us under How to pay below. Access returns automatically within minutes of Wattanam finance confirming the payment; press Sync now to check sooner.</p>}{standing === 'suspended' && !billingSuspension && <p className="mt-3 text-sm">This suspension was not caused by an unpaid invoice. Contact Wattanam support to restore access.</p>}{state.lockLiftedByOutage && <p className="mt-3 text-sm">Wattanam has not been reachable for more than seven days, so the billing lock is lifted until contact is restored. The balance shown is the last one received.</p>}</div><div className="text-right"><div className="text-xs uppercase text-slate-500">Outstanding</div><div className="text-xl font-bold">{money(state.billing?.outstandingMinor, currency)}</div></div></div>{canDownloadRecords && <div className="mt-4 rounded-xl border border-red-200 bg-white p-4 print:hidden"><h3 className="text-sm font-semibold text-slate-800">Download your school&apos;s records</h3><p className="mt-1 text-xs text-slate-600">Your records stay yours while access is suspended. Each download is recorded in the audit log.</p><div className="mt-3 flex flex-wrap gap-2"><a className="btn btn-secondary" href="/api/admin/data-export/students.csv">Students (CSV)</a><a className="btn btn-secondary" href="/api/admin/data-export/attendance.csv">Attendance (CSV)</a><a className="btn btn-secondary" href="/api/admin/data-export/grades.csv">Grades (CSV)</a></div></div>}{state.lastVerifiedAt && <p className="mt-3 text-xs text-slate-500">Verified with the marketplace {new Date(state.lastVerifiedAt).toLocaleString()}</p>}{state.lastError && <p className="mt-2 text-sm text-red-700">Last sync error: {state.lastError}</p>}</div>;

  const plan = state.billing?.billingPlan
    ? <p>{state.billing.billingPlan.name} · {money(state.billing.billingPlan.amountMinor, state.billing.billingPlan.currency)} / {state.billing.billingPlan.billingInterval.toLowerCase()}</p>
    : <p className="text-sm text-slate-500">No central billing plan assigned.</p>;

  const invoiceTable = invoices.length === 0 ? <p className="text-sm text-slate-500">No open invoices.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Invoice</th><th>Description</th><th>Due</th><th>Status</th><th className="text-right">Balance</th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id} className="border-b last:border-0"><td className="py-3 font-mono font-semibold">{invoice.invoiceNumber}</td><td>{(invoice.lines?.length || 0) > 1
      // Several lines: they are the description. The headline alone ("Standard (monthly)") read
      // as the whole bill beside a balance that also carried a plugin.
      ? <ul className="space-y-0.5">{invoice.lines!.map(line => <li key={line.id}>{line.description}{line.quantity > 1 ? ` × ${line.quantity}` : ''} <span className="text-slate-500">— {money(line.amountMinor, invoice.currency)}</span></li>)}</ul>
      : invoice.description}</td><td>{new Date(invoice.dueAt).toLocaleDateString()}</td><td>{isOverdue(invoice) ? <span className="font-semibold text-red-700">overdue</span> : invoice.status.toLowerCase().replaceAll('_', ' ')}{submissionNote(invoice)}</td><td className="text-right font-semibold">{money(invoice.amountMinor - invoice.paidMinor, invoice.currency)}</td></tr>)}</tbody></table></div>;

  const accounts = state.billing?.paymentMethods || [];
  const openInvoices = invoices.filter(isOpen);
  const payInvoice = openInvoices.find((invoice) => invoice.id === payInvoiceId) || nextDue;
  const chosenMethodId = payMethodId || (accounts.length === 1 ? accounts[0].id : '');
  const shownAmount = payAmount !== '' ? payAmount : (payInvoice ? ((payInvoice.amountMinor - payInvoice.paidMinor) / 100).toFixed(2) : '');

  async function pickReceipt(file?: File) {
    if (!file) return;
    try { setPayReceipt(await imageFileToDataUrl(file, { maxDimension: 1200, maxBytes: 150 * 1024 })); }
    catch (cause) { setPayMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not read that image' }); }
  }

  /**
   * Sends the payment through this school's own backend, which signs it with the installation key --
   * no marketplace account or second sign-in needed. On success the backend has already re-synced,
   * so reloading shows the payment as awaiting confirmation.
   */
  async function submitPayment(event: React.FormEvent) {
    event.preventDefault(); setPayMessage(null);
    const amountMinor = Math.round(Number(shownAmount) * 100);
    if (!payInvoice) return setPayMessage({ tone: 'error', text: 'There is no open invoice to pay.' });
    if (!chosenMethodId) return setPayMessage({ tone: 'error', text: 'Choose the account you paid into, so finance knows which bank statement to check.' });
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return setPayMessage({ tone: 'error', text: 'Enter the amount you paid.' });
    if (payReference.trim().length < 3) return setPayMessage({ tone: 'error', text: 'Enter the transaction reference from your bank receipt.' });
    setPayBusy(true);
    try {
      const response = await apiFetch('/api/admin/marketplace/billing-control/payment-submissions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceId: payInvoice.id, paymentMethodId: chosenMethodId, amountMinor, providerReference: payReference.trim(),
          ...(payNote.trim() ? { note: payNote.trim() } : {}), ...(payReceipt ? { receiptImage: payReceipt } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join('. ') : body.message || 'The payment could not be submitted');
      setPayReference(''); setPayNote(''); setPayReceipt(''); setPayAmount('');
      setPayMessage({ tone: 'ok', text: 'Submitted. Wattanam finance will confirm it against the bank statement, and this bill updates when they do.' });
      await load();
    } catch (cause) { setPayMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'The payment could not be submitted' }); }
    finally { setPayBusy(false); }
  }

  // Any edit clears the last message, so an error about a field the admin has since fixed does not linger.
  const paymentForm = payInvoice ? <form className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" onSubmit={submitPayment} onChange={() => setPayMessage(null)} aria-labelledby="tell-us-you-paid">
    <h4 id="tell-us-you-paid" className="font-semibold text-slate-800">Tell us you paid</h4>
    <p className="mt-1 text-xs text-slate-500">After transferring, enter the transaction reference from your bank receipt. Attaching the receipt screenshot helps finance confirm it faster.</p>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {openInvoices.length > 1 && <select className="rounded-lg border px-3 py-2" aria-label="Invoice you paid" value={payInvoice.id} onChange={(event) => { setPayInvoiceId(event.target.value); setPayAmount(''); }}>{openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {money(invoice.amountMinor - invoice.paidMinor, invoice.currency)}</option>)}</select>}
      {accounts.length > 1 && <select className="rounded-lg border px-3 py-2" aria-label="Account you paid into" value={chosenMethodId} onChange={(event) => setPayMethodId(event.target.value)}><option value="">Account you paid into…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.accountNumber}</option>)}</select>}
      <label className="text-xs text-slate-600">Amount paid<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" inputMode="decimal" value={shownAmount} onChange={(event) => setPayAmount(event.target.value)} /></label>
      <label className="text-xs text-slate-600">Bank transaction reference<input className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm" placeholder="From your bank receipt" value={payReference} onChange={(event) => setPayReference(event.target.value)} /></label>
      <label className="text-xs text-slate-600 md:col-span-2">Note for finance (optional)<textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={payNote} onChange={(event) => setPayNote(event.target.value)} maxLength={2000} /></label>
      <div className="flex flex-wrap items-start gap-3 md:col-span-2"><label className="btn btn-secondary cursor-pointer">{payReceipt ? 'Replace receipt screenshot' : 'Attach receipt screenshot (optional)'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { pickReceipt(event.target.files?.[0]); event.target.value = ''; }} /></label>{payReceipt && <><img src={payReceipt} alt="Receipt to be submitted" className="max-h-32 rounded border bg-white object-contain" /><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPayReceipt('')}>Remove</button></>}</div>
    </div>
    {payMessage && <p role={payMessage.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${payMessage.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{payMessage.text}</p>}
    <button className="btn btn-primary mt-3" disabled={payBusy}>{payBusy ? 'Submitting…' : 'Submit payment for confirmation'}</button>
  </form> : null;
  // Shown whenever something is owed -- including to a suspended school, which needs it most.
  const howToPay = outstanding > 0 && accounts.length > 0 ? <div className="space-y-3">
    <p className="text-sm text-slate-600">Pay into one of these accounts{nextDue ? <> and put <strong className="font-mono">{nextDue.invoiceNumber}</strong> in the transfer remark</> : null}, so finance can match the transfer to this bill. Then tell us below, and Wattanam finance confirms it against the bank statement.</p>
    <div className="grid gap-3 md:grid-cols-2">{accounts.map(account => <div key={account.id} className="flex gap-4 rounded-xl border bg-white p-4 text-sm">
      <div className="min-w-0 flex-1"><strong>{account.label}</strong><div className="text-slate-600">{account.bankName}</div><div className="text-slate-600">{account.accountName}</div><div className="mt-1 font-mono text-base">{account.accountNumber}</div>{account.instructions && <p className="mt-2 text-xs text-slate-500">{account.instructions}</p>}</div>
      {account.qrImage && <figure className="shrink-0 text-center"><img src={account.qrImage} alt={'QR code to pay ' + account.label} className="h-32 w-32 rounded-lg border bg-white object-contain" /><figcaption className="mt-1 text-xs text-slate-500">Scan with your bank app</figcaption></figure>}
    </div>)}</div>
    {paymentForm}
  </div> : null;

  const shownNotices = variant === 'section' ? notices.slice(0, 3) : notices;
  const noticeList = notices.length === 0 ? <p className="text-sm text-slate-500">No billing notifications.</p> : <div className="space-y-2">{shownNotices.map(notice => <article key={notice.id} className="rounded-xl border p-3 text-sm"><div className="flex justify-between gap-3"><strong>{notice.subject}</strong><time className="text-xs text-slate-500">{new Date(notice.createdAt).toLocaleString()}</time></div><p className="mt-1 text-slate-700">{notice.message}</p></article>)}{shownNotices.length < notices.length && <Link className="text-sm font-semibold text-indigo-700" href="/admin/platform-billing">All {notices.length} billing notifications →</Link>}</div>;

  if (variant === 'section') {
    return <Frame variant="section" actions={<><Link className="btn btn-secondary" href="/admin/platform-billing">Full billing page</Link>{syncButton}</>}>
      {status}
      <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold text-slate-700">Plan</h3><div className="mt-2">{plan}</div></div>
      <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold text-slate-700">Invoices</h3><div className="mt-2">{invoiceTable}</div></div>
      {howToPay && <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold text-slate-700">How to pay</h3><div className="mt-2">{howToPay}</div></div>}
      <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold text-slate-700">Recent billing notifications</h3><div className="mt-2">{noticeList}</div></div>
      <div className="mt-4">{freshness}</div>
    </Frame>;
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">{freshness}{syncButton}</div>
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}
    {status}
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Plan</h2><div className="mt-2">{plan}</div></section>
    <section className="rounded-2xl border bg-white p-5"><div className="flex justify-between"><h2 className="font-semibold">Invoices</h2><button className="text-sm font-semibold text-indigo-700 print:hidden" onClick={() => window.print()}>Print / save PDF</button></div><div className="mt-3">{invoiceTable}</div></section>
    {howToPay && <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">How to pay</h2><div className="mt-3">{howToPay}</div></section>}
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Billing notifications</h2><div className="mt-3">{noticeList}</div></section>
  </div>;
}

/** The section variant is one Licensing-style card; the page variant lays its blocks out itself. */
function Frame({ variant, actions, children }: { variant: 'page' | 'section'; actions: React.ReactNode; children: React.ReactNode }) {
  if (variant === 'page') return <div className="space-y-5"><div className="flex justify-end print:hidden">{actions}</div>{children}</div>;
  return <section id="platform-billing" className="card p-6" aria-labelledby="platform-billing-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="platform-billing-title" className="font-semibold text-slate-800">Platform subscription</h2>
        <p className="mt-1 text-sm text-slate-500">What this school owes Wattanam for the platform itself — separate from the plugin licences below, and from student fees.</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
    <div className="mt-5">{children}</div>
  </section>;
}
