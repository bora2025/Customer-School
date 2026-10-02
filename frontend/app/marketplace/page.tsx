'use client';

import Link from 'next/link';
import { imageFileToDataUrl } from '../../lib/image-upload';
import { useEffect, useState } from 'react';
import { formatMoney } from '../../lib/formatMoney';

type Product = { id: string; name: string; description: string; license: string; paid: boolean; compatible: boolean; publisher: { displayName: string }; prices: Array<{ id: string; currency: string; amountMinor: number }>; versions: Array<{ version: string; requiresCore: string; changelog?: string; sha256?: string }>; ownership?: Array<{ installationId: string; installationLabel?: string; status: string; expiresAt?: string }> };
type Installation = { installationId: string };
type PortalEntitlement = { pluginId: string; status: string; signedToken: unknown; installation: { installationId: string; label?: string }; plugin: { name: string } };
type PluginRequest = { id: string; type: string; status: string; submittedAt: string; slaDueAt: string; plugin?: { id: string; name: string }; installation: { installationId: string; label?: string } };
type PaymentAccount = { id: string; label: string; bankName: string; accountName: string; accountNumber: string; currency: string; qrImage?: string | null; instructions?: string | null };
type SchoolBilling = {
  schoolId: string; schoolName: string; schoolStatus: string; schoolCurrency?: string; outstandingMinor: number;
  billingPlan?: { name: string; currency: string; amountMinor: number; billingInterval: string; dueDays: number };
  billingAnchorAt?: string | null;
  paymentMethods?: PaymentAccount[];
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; amountMinor: number; paidMinor: number; description: string; dueAt: string; issuedAt: string; paidAt?: string; lines?: Array<{ id: string; kind: string; description: string; quantity: number; amountMinor: number }>; paymentSubmissions?: Array<{ id: string; status: string; providerReference: string; amountMinor: number; rejectionReason?: string }> }>;
  notifications: Array<{ id: string; invoiceId: string; type: string; subject: string; message: string; createdAt: string; sentAt?: string }>;
};

/** "overdue" is derived here: the marketplace keeps an unpaid invoice ISSUED past its due date. */
function invoiceStatus(invoice: { status: string; dueAt: string }) {
  const overdue = invoice.status !== 'PAID' && invoice.status !== 'VOID' && new Date(invoice.dueAt).getTime() < Date.now();
  if (overdue) return { label: 'overdue', className: 'font-semibold text-red-700' };
  return { label: invoice.status.toLowerCase().replaceAll('_', ' '), className: invoice.status === 'PAID' ? 'text-emerald-700' : invoice.status === 'VOID' ? 'text-slate-500' : 'text-amber-800' };
}

/**
 * The accounts this invoice can be paid into, each with its bank's QR code. The invoice number is
 * shown as the transfer remark because it is what lets finance match a line on the bank statement to
 * this bill -- a transfer without it is money nobody can place.
 */
function PayToAccounts({ accounts, invoiceNumber, amountLabel, selectedId, onSelect }: {
  accounts: PaymentAccount[]; invoiceNumber: string; amountLabel: string; selectedId: string; onSelect: (id: string) => void;
}) {
  const [copied, setCopied] = useState('');
  if (accounts.length === 0) return null;
  return <div className="space-y-3 rounded-xl border border-slate-200 p-4">
    <h3 className="text-sm font-semibold">1. Pay into one of these accounts</h3>
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">Transfer remark: <strong className="font-mono">{invoiceNumber}</strong> · Amount: <strong>{amountLabel}</strong></div>
    <div className="grid gap-3 lg:grid-cols-2">{accounts.map(account => <label key={account.id} className={`flex cursor-pointer gap-4 rounded-xl border p-4 text-sm ${selectedId === account.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
      <input type="radio" name="payment-account" className="mt-1" checked={selectedId === account.id} onChange={() => onSelect(account.id)} />
      <div className="min-w-0 flex-1">
        <strong>{account.label}</strong>
        <div className="text-slate-600">{account.bankName}</div>
        <div className="text-slate-600">{account.accountName}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2"><span className="font-mono text-base">{account.accountNumber}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(account.accountNumber.replace(/\s+/g, '')).then(() => setCopied(account.id)).catch(() => undefined); }}>{copied === account.id ? 'Copied' : 'Copy'}</button></div>
        {account.instructions && <p className="mt-2 text-xs text-slate-500">{account.instructions}</p>}
      </div>
      {account.qrImage && <figure className="shrink-0 text-center"><img src={account.qrImage} alt={`QR code to pay ${account.label}`} className="h-36 w-36 rounded-lg border bg-white object-contain" /><figcaption className="mt-1 text-xs text-slate-500">Scan with your bank app</figcaption></figure>}
    </label>)}</div>
  </div>;
}

export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [entitlements, setEntitlements] = useState<PortalEntitlement[]>([]);
  const [pluginRequests, setPluginRequests] = useState<PluginRequest[]>([]);
  const [schoolBilling, setSchoolBilling] = useState<SchoolBilling[]>([]);
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [signedIn, setSignedIn] = useState(false); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [requestType, setRequestType] = useState('FREE_APPROVAL'); const [requestPluginId, setRequestPluginId] = useState('');
  const [requestReason, setRequestReason] = useState(''); const [featureDescription, setFeatureDescription] = useState('');
  const [requestResponses, setRequestResponses] = useState<Record<string, string>>({});
  const [paymentInvoiceId, setPaymentInvoiceId] = useState(''); const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentProvider, setPaymentProvider] = useState('bank-transfer'); const [paymentReference, setPaymentReference] = useState(''); const [paymentNote, setPaymentNote] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState(''); const [receiptImage, setReceiptImage] = useState('');

  async function load() {
    const [core, versionResponse] = await Promise.all([fetch('/api/admin/marketplace/installation', { credentials: 'include' }), fetch('/api/version', { cache: 'no-store' })]);
    if (core.ok) setInstallation(await core.json());
    const versionBody = versionResponse.ok ? await versionResponse.json() : {};
    const coreVersion = typeof versionBody.version === 'string' ? versionBody.version : '1.0.0';
    const catalog = await fetch(`/api/marketplace/catalog?coreVersion=${encodeURIComponent(coreVersion)}`, { cache: 'no-store' });
    if (!catalog.ok) throw new Error((await catalog.json()).error || 'Could not load marketplace');
    const data = await catalog.json(); setProducts(data);
    const owned = await fetch('/api/marketplace/customer/entitlements', { cache: 'no-store' });
    if (owned.ok) {
      setEntitlements(await owned.json()); setSignedIn(true);
      const [requests, billing] = await Promise.all([
        fetch('/api/marketplace/customer/plugin-requests', { cache: 'no-store' }),
        fetch('/api/marketplace/customer/school-billing', { cache: 'no-store' }),
      ]);
      setPluginRequests(requests.ok ? await requests.json() : []);
      setSchoolBilling(billing.ok ? await billing.json() : []);
    } else { setEntitlements([]); setPluginRequests([]); setSchoolBilling([]); setSignedIn(false); }
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);

  async function login() {
    setBusy('login'); setMessage('');
    const response = await fetch('/api/marketplace/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, ...(code ? { code } : {}) }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Sign-in failed');
    if (body.status === 'mfa_required') return setMessage('Enter your MFA or recovery code, then sign in again.');
    setSignedIn(true); setMessage('Signed in securely.'); await load();
  }

  /**
   * The school this installation belongs to can be billed on account when it has a plan, a billing
   * anniversary, and is billed in the same currency as the price. Anything else and the only route
   * is paying now -- so the button is not offered rather than offered and then refused.
   */
  function invoiceableSchool(price?: { currency: string }) {
    if (!price) return null;
    const school = schoolBilling[0];
    if (!school?.billingPlan || !school.billingAnchorAt) return null;
    if ((school.schoolCurrency || school.billingPlan.currency) !== price.currency) return null;
    return school;
  }

  async function checkout(product: Product, settlementMode: 'IMMEDIATE' | 'INVOICE' = 'IMMEDIATE') {
    const price = product.prices[0];
    if (!installation?.installationId || !price) return setMessage('Register this school installation and select an available price first.');
    setBusy(product.id); setMessage('');
    const response = await fetch('/api/marketplace/customer/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: installation.installationId, currency: price.currency, priceIds: [price.id], idempotencyKey: crypto.randomUUID(), settlementMode }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Checkout failed');
    setMessage(settlementMode === 'INVOICE'
      ? `${product.name} is licensed now and will appear on your next school invoice as a separate line.`
      : `Order ${body.id} created. Online payment or an authorized manual invoice must settle it before activation.`);
  }

  /** The receiving accounts in the currency of the invoice being paid. */
  function accountsForInvoice(invoiceId: string) {
    const school = schoolBilling.find(item => item.invoices.some(invoice => invoice.id === invoiceId));
    const invoice = school?.invoices.find(item => item.id === invoiceId);
    return (school?.paymentMethods || []).filter(method => !invoice || method.currency === invoice.currency);
  }

  function payTo() {
    const invoice = schoolBilling.flatMap(school => school.invoices).find(item => item.id === paymentInvoiceId);
    if (!invoice) return null;
    const accounts = accountsForInvoice(invoice.id);
    if (accounts.length === 0) return null;
    // The step-2 heading sits here, directly above the fields it introduces -- inside the accounts
    // box it read as a caption for the box instead.
    return <><PayToAccounts accounts={accounts} invoiceNumber={invoice.invoiceNumber} amountLabel={formatMoney(invoice.amountMinor - invoice.paidMinor, invoice.currency)} selectedId={paymentMethodId} onSelect={(id) => { setPaymentMethodId(id); setPaymentProvider('bank-transfer'); }} /><h3 className="mt-4 text-sm font-semibold">2. Tell us you paid</h3></>;
  }

  async function pickReceipt(file?: File) {
    if (!file) return;
    try { setReceiptImage(await imageFileToDataUrl(file, { maxDimension: 1200, maxBytes: 150 * 1024 })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read that image'); }
  }

  async function submitSchoolPayment() {
    const invoice = schoolBilling.flatMap(school => school.invoices).find(item => item.id === paymentInvoiceId);
    const amountMinor = Math.round(Number(paymentAmount) * 100);
    if (!invoice || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !paymentReference.trim()) return setMessage('Select an invoice and enter a valid amount and payment reference.');
    if (accountsForInvoice(invoice.id).length > 0 && !paymentMethodId) return setMessage('Choose the account you paid into, so finance knows which bank statement to check.');
    setBusy('school-payment'); setMessage('');
    const response = await fetch('/api/marketplace/customer/school-billing/payment-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id, provider: paymentProvider, providerReference: paymentReference.trim(), amountMinor, ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}), ...(paymentMethodId ? { paymentMethodId } : {}), ...(receiptImage ? { receiptImage } : {}) }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Payment submission failed');
    setPaymentReference(''); setPaymentAmount(''); setPaymentNote(''); setPaymentMethodId(''); setReceiptImage(''); setMessage('Payment evidence submitted for finance review. The invoice remains due until it is approved.'); await load();
  }

  async function submitPluginRequest() {
    if (!installation?.installationId) return setMessage('Register and link this school installation first.');
    if (requestReason.trim().length < 10) return setMessage('Explain why the school needs this plugin (at least 10 characters).');
    if (requestType !== 'FEATURE_REQUEST' && !requestPluginId) return setMessage('Select a plugin.');
    if (requestType === 'FEATURE_REQUEST' && featureDescription.trim().length < 10) return setMessage('Describe the requested feature.');
    setBusy('plugin-request'); setMessage('');
    const response = await fetch('/api/marketplace/customer/plugin-requests', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: installation.installationId, type: requestType, justification: requestReason, ...(requestType === 'FEATURE_REQUEST' ? { featureDescription } : { pluginId: requestPluginId }) }),
    });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Plugin request failed');
    setRequestReason(''); setFeatureDescription(''); setMessage(`Request ${body.id} submitted.`); await load();
  }

  async function respondToPluginRequest(requestId: string) {
    const responseText = requestResponses[requestId]?.trim();
    if (!responseText) return setMessage('Enter the requested information.');
    setBusy(`respond:${requestId}`); setMessage('');
    const response = await fetch(`/api/marketplace/customer/plugin-requests/${requestId}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), body: responseText }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Could not send information');
    setRequestResponses(current => ({ ...current, [requestId]: '' })); setMessage('Information sent for review.'); await load();
  }

  async function cancelPluginRequest(requestId: string) {
    setBusy(`cancel:${requestId}`); setMessage('');
    const response = await fetch(`/api/marketplace/customer/plugin-requests/${requestId}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Cancelled by the requesting customer.' }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Could not cancel request');
    setMessage('Request cancelled.'); await load();
  }

  function exportEntitlement(entitlement: PortalEntitlement) {
    const exportDocument = { schemaVersion: 1, pluginId: entitlement.pluginId, installationId: entitlement.installation.installationId, status: entitlement.status, signedToken: entitlement.signedToken, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportDocument, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${entitlement.pluginId}-${entitlement.installation.installationId}-entitlement.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function logout() {
    await fetch('/api/marketplace/sessions/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: 'managed-by-secure-proxy' }) });
    setSignedIn(false); setEntitlements([]); setPluginRequests([]); setSchoolBilling([]); setMessage('Signed out.');
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold text-slate-900">Wattanam Marketplace</h1><p className="mt-2 text-slate-600">Compatible official plugins, licensing, and secure acquisition for this school.</p></div><div className="flex flex-wrap gap-2"><Link className="btn btn-secondary" href="/marketplace/publisher">Publisher portal</Link><Link className="btn btn-secondary" href="/marketplace/reviewer">Reviewer queue</Link></div></header>
    {message && <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">{message}</div>}
    {signedIn && schoolBilling.some(school => school.invoices.some(invoice => !['PAID', 'VOID'].includes(invoice.status))) && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Submit subscription payment</h2><p className="mt-1 text-xs text-slate-500">Pay into one of Wattanam's accounts — by bank transfer or by scanning its QR code — then enter the bank reference. Finance checks it against the bank statement before the invoice is marked paid.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><select className="rounded-lg border px-3 py-2" value={paymentInvoiceId} onChange={event => { const invoice = schoolBilling.flatMap(school => school.invoices).find(item => item.id === event.target.value); setPaymentInvoiceId(event.target.value); if (invoice) setPaymentAmount(((invoice.amountMinor - invoice.paidMinor) / 100).toFixed(2)); const accounts = accountsForInvoice(event.target.value); setPaymentMethodId(accounts.length === 1 ? accounts[0].id : ''); }}><option value="">Select invoice</option>{schoolBilling.flatMap(school => school.invoices).filter(invoice => !['PAID', 'VOID'].includes(invoice.status)).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {formatMoney(invoice.amountMinor - invoice.paidMinor, invoice.currency)}</option>)}</select><div className="md:col-span-2">{payTo()}</div><input className="rounded-lg border px-3 py-2" inputMode="decimal" placeholder="Amount paid" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /><input className="rounded-lg border px-3 py-2" placeholder="Provider (for example bank-transfer)" value={paymentProvider} onChange={event => setPaymentProvider(event.target.value)} /><input className="rounded-lg border px-3 py-2" placeholder="Transaction/reference number" value={paymentReference} onChange={event => setPaymentReference(event.target.value)} /><textarea className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Optional payment note" value={paymentNote} onChange={event => setPaymentNote(event.target.value)} /><div className="md:col-span-2"><label className="btn btn-secondary cursor-pointer">{receiptImage ? 'Replace receipt screenshot' : 'Attach receipt screenshot (optional)'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { pickReceipt(event.target.files?.[0]); event.target.value = ''; }} /></label>{receiptImage && <div className="mt-2 flex items-start gap-3"><img src={receiptImage} alt="Receipt to be submitted" className="max-h-40 rounded border object-contain" /><button type="button" className="btn btn-secondary btn-sm" onClick={() => setReceiptImage('')}>Remove</button></div>}</div></div><button className="btn btn-primary mt-3" disabled={!!busy} onClick={submitSchoolPayment}>{busy === 'school-payment' ? 'Submitting…' : 'Submit for review'}</button></section>}
    {!signedIn && <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="font-semibold">Customer sign in</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><input aria-label="Email" className="rounded-lg border px-3 py-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} /><input aria-label="Password" type="password" className="rounded-lg border px-3 py-2" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} /><input aria-label="MFA code" className="rounded-lg border px-3 py-2" placeholder="MFA/recovery code (if enabled)" value={code} onChange={e=>setCode(e.target.value)} /></div><button className="btn btn-primary mt-4" disabled={!!busy} onClick={login}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button></section>}
    {signedIn && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">School subscription billing</h2><p className="mt-1 text-xs text-slate-500">Bills from Wattanam Marketplace for operating this school, including plugins added to your school invoice. They are separate from student fees.</p>{schoolBilling.length === 0 ? <p className="mt-3 text-sm text-slate-500">No linked school billing account or invoices were found.</p> : <div className="mt-4 space-y-5">{schoolBilling.map(school=><div key={school.schoolId} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{school.schoolName}</h3><p className="text-xs text-slate-500">{school.billingPlan ? `${school.billingPlan.name} · ${formatMoney(school.billingPlan.amountMinor, school.billingPlan.currency)} ${school.billingPlan.billingInterval.toLowerCase()}` : 'No central billing plan assigned'}</p></div><div className={`rounded-full px-3 py-1 text-sm font-semibold ${school.outstandingMinor > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>Outstanding {formatMoney(school.outstandingMinor, school.schoolCurrency || 'USD')}</div></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h4 className="text-sm font-semibold">Invoices</h4>{school.invoices.length === 0 ? <p className="mt-2 text-sm text-slate-500">No invoices.</p> : <div className="mt-2 space-y-2">{school.invoices.map(invoice=><div key={invoice.id} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{invoice.invoiceNumber}</strong><span className={invoiceStatus(invoice).className}>{invoiceStatus(invoice).label}</span></div>{(invoice.lines?.length || 0) > 1 ? null : <p className="mt-1 text-slate-600">{invoice.description}</p>}{(invoice.lines?.length || 0) > 1 && <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">{invoice.lines!.map(line => <li key={line.id} className="flex justify-between gap-3"><span>{line.description}{line.quantity > 1 ? ` × ${line.quantity}` : ''}</span><span className="font-medium">{formatMoney(line.amountMinor, invoice.currency)}</span></li>)}</ul>}<p className="mt-1 text-xs text-slate-500">Total {formatMoney(invoice.amountMinor, invoice.currency)} · paid {formatMoney(invoice.paidMinor, invoice.currency)} · due {new Date(invoice.dueAt).toLocaleDateString()}</p></div>)}</div>}</div><div><h4 className="text-sm font-semibold">Billing notifications</h4>{school.notifications.length === 0 ? <p className="mt-2 text-sm text-slate-500">No billing notifications.</p> : <div className="mt-2 space-y-2">{school.notifications.map(notification=><div key={notification.id} className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm"><strong>{notification.subject}</strong><p className="mt-1 text-slate-700">{notification.message}</p><p className="mt-1 text-xs text-slate-500">{new Date(notification.createdAt).toLocaleString()}</p></div>)}</div>}</div></div></div>)}</div>}</section>}
    {signedIn && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">My licences</h2><p className="text-xs text-slate-500">Export a signed token for offline school activation. Refund or expiry never deletes school data.</p></div><button className="btn btn-secondary" onClick={logout}>Sign out</button></div>{entitlements.length === 0 ? <p className="mt-3 text-sm text-slate-500">No licences yet.</p> : <div className="mt-3 space-y-2">{entitlements.map(item=><div key={`${item.pluginId}:${item.installation.installationId}`} className="flex flex-wrap items-center justify-between rounded-lg border p-3 text-sm"><span><strong>{item.plugin.name}</strong> · {item.status.toLowerCase()} · {item.installation.label||item.installation.installationId}</span><button className="btn btn-secondary" onClick={()=>exportEntitlement(item)}>Export offline token</button></div>)}</div>}</section>}
    {signedIn && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Request a plugin or feature</h2><p className="mt-1 text-xs text-slate-500">Wattanam approval does not install software. Your school administrator keeps final installation control.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Request type<select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={requestType} onChange={event=>setRequestType(event.target.value)}>{['FREE_APPROVAL','PURCHASE_ASSISTANCE','PRIVATE_PLUGIN_ACCESS','TRIAL','FEATURE_REQUEST'].map(value=><option key={value} value={value}>{value.toLowerCase().replaceAll('_',' ')}</option>)}</select></label>{requestType !== 'FEATURE_REQUEST' && <label className="text-xs font-medium">Plugin<select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={requestPluginId} onChange={event=>setRequestPluginId(event.target.value)}><option value="">Select plugin</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}<label className="text-xs font-medium md:col-span-2">Why does the school need this?<textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" value={requestReason} onChange={event=>setRequestReason(event.target.value)} /></label>{requestType === 'FEATURE_REQUEST' && <label className="text-xs font-medium md:col-span-2">Feature description<textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" value={featureDescription} onChange={event=>setFeatureDescription(event.target.value)} /></label>}</div><button className="btn btn-primary mt-3" disabled={!!busy} onClick={submitPluginRequest}>{busy === 'plugin-request' ? 'Submitting…' : 'Submit request'}</button>{pluginRequests.length > 0 && <div className="mt-5 space-y-2"><h3 className="text-sm font-semibold">Request history</h3>{pluginRequests.map(item=><div key={item.id} className="rounded-lg border p-3 text-sm"><strong>{item.plugin?.name || 'Feature request'}</strong> · {item.status.toLowerCase().replaceAll('_',' ')}<div className="mt-1 text-xs text-slate-500">Submitted {new Date(item.submittedAt).toLocaleString()} · target {new Date(item.slaDueAt).toLocaleString()}</div>{item.status === 'NEEDS_INFORMATION' && <div className="mt-3 flex gap-2"><input aria-label="Requested information" className="min-w-0 flex-1 rounded-lg border px-3 py-2" placeholder="Provide the requested information" value={requestResponses[item.id] || ''} onChange={event=>setRequestResponses(current=>({ ...current, [item.id]: event.target.value }))} /><button className="btn btn-primary" disabled={!!busy} onClick={()=>respondToPluginRequest(item.id)}>Send</button></div>}{!['REJECTED','CANCELLED','ENTITLEMENT_ISSUED'].includes(item.status) && <button className="btn btn-secondary mt-2" disabled={!!busy} onClick={()=>cancelPluginRequest(item.id)}>{busy === `cancel:${item.id}` ? 'Cancelling…' : 'Cancel request'}</button>}</div>)}</div>}</section>}
    <section className="grid gap-5 md:grid-cols-2">{products.map(product => <article key={product.id} className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-900">{product.name}</h2><p className="text-xs text-slate-500">{product.publisher.displayName} · {product.license}</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs font-semibold ${product.compatible?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>{product.compatible?'Compatible':'Incompatible'}</span></div><p className="mt-3 text-sm text-slate-600">{product.description}</p><div className="mt-4 text-sm"><strong>{product.paid ? (product.prices[0] ? formatMoney(product.prices[0].amountMinor, product.prices[0].currency) : 'Price unavailable') : 'Free'}</strong>{product.versions[0] && <p className="mt-1 text-xs text-slate-500">Version {product.versions[0].version} · core {product.versions[0].requiresCore}<br />{product.versions[0].changelog}</p>}</div>{product.ownership?.length ? <div className="mt-4 space-y-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><div>Owned: {product.ownership.map(x=>`${x.installationLabel||x.installationId} (${x.status.toLowerCase()})`).join(', ')}</div>{product.versions[0]?.sha256 && <a className="btn btn-primary inline-flex" href={`/api/marketplace/artifacts/${product.versions[0].sha256}`}>Download verified package</a>}</div> : product.paid ? <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" disabled={!signedIn || !product.compatible || busy===product.id} onClick={()=>checkout(product)}>{busy===product.id?'Creating order…':'Buy now'}</button>{invoiceableSchool(product.prices[0]) && <button className="btn btn-secondary" disabled={!signedIn || !product.compatible || busy===product.id} onClick={()=>checkout(product, 'INVOICE')} title="Licensed immediately; charged on your next school invoice">Add to my school invoice</button>}</div> : <div className="mt-4 text-sm text-indigo-700">Free acquisition is available through the school plugin installer.</div>}</article>)}</section>
  </div></main>;
}
