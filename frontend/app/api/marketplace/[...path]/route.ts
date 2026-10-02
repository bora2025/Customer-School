import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'wattanam_marketplace_session';
const publicGet = new Set(['catalog', 'publisher-policies']);
const sessionGet = new Set(['customer/orders', 'customer/entitlements', 'customer/plugin-requests', 'customer/school-billing', 'publishers', 'publisher-submissions', 'reviewer/submissions']);
const publicPost = new Set(['accounts', 'accounts/email-verifications/confirm', 'sessions', 'sessions/refresh', 'password-resets', 'password-resets/confirm']);
const sessionPost = new Set(['customer/orders', 'customer/plugin-requests', 'sessions/revoke', 'mfa/enrollments', 'mfa/enrollments/confirm', 'mfa/disable', 'publishers', 'publisher-submissions']);
const customerBillingPaymentPath = /^customer\/school-billing\/payment-submissions$/;
const linkRequestPathPattern = /^marketplace-links\/[0-9a-f-]{36}$/;
const linkDecisionPathPattern = /^marketplace-links\/[0-9a-f-]{36}\/(approve|deny)$/;
const pluginRequestActionPattern = /^customer\/plugin-requests\/[0-9a-f-]{36}\/(respond|cancel)$/;
const publisherDetailPathPattern = /^publishers\/[0-9a-f-]{36}$/;
const publisherSubmissionDetailPathPattern = /^publisher-submissions\/[0-9a-f-]{36}$/;
const publisherPolicyAcceptancePathPattern = /^publishers\/[0-9a-f-]{36}\/policies\/[0-9a-f-]{36}\/accept$/;
const publisherKeyRequestPathPattern = /^publishers\/[0-9a-f-]{36}\/keys$/;
const publisherMemberCreatePathPattern = /^publishers\/[0-9a-f-]{36}\/members$/;
const publisherMemberActionPathPattern = /^publishers\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}\/(suspend|reactivate)$/;
const publisherKeyActionPathPattern = /^publisher-keys\/[0-9a-f-]{36}\/(approve|revoke)$/;
const reviewerSubmissionDetailPathPattern = /^reviewer\/submissions\/[0-9a-f-]{36}$/;
const reviewerSubmissionReviewPathPattern = /^reviewer\/submissions\/[0-9a-f-]{36}\/reviews$/;

function marketplaceUrl() {
  const value = process.env.MARKETPLACE_URL;
  if (!value) throw new Error('MARKETPLACE_URL is not configured');
  return value;
}

/** Railway terminates TLS before the school gateway, so Next.js can observe an internal `http`
 * scheme for a browser request whose real Origin is `https`. Comparing full origins therefore
 * rejects valid same-origin mutations. Host equality is stable across that boundary; production
 * still requires the browser Origin itself to be HTTPS. */
function allowsMutationOrigin(request: NextRequest, origin: string): boolean {
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return false;
  const hosts = new Set<string>();
  for (const header of ['host', 'x-forwarded-host']) {
    for (const value of (request.headers.get(header) || '').split(',')) {
      const host = value.trim().toLowerCase();
      if (host) hosts.add(host);
    }
  }
  hosts.add(request.nextUrl.host.toLowerCase());
  return hosts.has(parsed.host.toLowerCase());
}

async function proxy(request: NextRequest, segments: string[], method: 'GET' | 'POST') {
  const path = segments.join('/');
  const protectedArtifact = method === 'GET' && /^artifacts\/[a-f0-9]{64}$/.test(path);
  const isPublicLinkRequest = method === 'GET' && linkRequestPathPattern.test(path);
  const isLinkDecision = method === 'POST' && linkDecisionPathPattern.test(path);
  const isPublisherPolicyAcceptance = method === 'POST' && publisherPolicyAcceptancePathPattern.test(path);
  const isPublisherKeyRequest = method === 'POST' && publisherKeyRequestPathPattern.test(path);
  const isPublisherMemberCreate = method === 'POST' && publisherMemberCreatePathPattern.test(path);
  const isPublisherMemberAction = method === 'POST' && publisherMemberActionPathPattern.test(path);
  const isPublisherKeyAction = method === 'POST' && publisherKeyActionPathPattern.test(path);
  const isReviewerSubmissionDetail = method === 'GET' && reviewerSubmissionDetailPathPattern.test(path);
  const isReviewerSubmissionReview = method === 'POST' && reviewerSubmissionReviewPathPattern.test(path);
  const allowed = method === 'GET'
    ? publicGet.has(path) || sessionGet.has(path) || protectedArtifact || isPublicLinkRequest || publisherDetailPathPattern.test(path) || publisherSubmissionDetailPathPattern.test(path) || isReviewerSubmissionDetail
    : publicPost.has(path) || sessionPost.has(path) || customerBillingPaymentPath.test(path) || isLinkDecision || pluginRequestActionPattern.test(path) || isPublisherPolicyAcceptance || isPublisherKeyRequest || isPublisherMemberCreate || isPublisherMemberAction || isPublisherKeyAction || isReviewerSubmissionReview;
  if (!allowed) return NextResponse.json({ error: 'Marketplace route is not allowed' }, { status: 404 });
  if (method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && !allowsMutationOrigin(request, origin)) return NextResponse.json({ error: 'Cross-origin marketplace mutation rejected' }, { status: 403 });
  }
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if ((sessionGet.has(path) || sessionPost.has(path) || customerBillingPaymentPath.test(path) || protectedArtifact || isLinkDecision || pluginRequestActionPattern.test(path) || publisherDetailPathPattern.test(path) || publisherSubmissionDetailPathPattern.test(path) || isPublisherPolicyAcceptance || isPublisherKeyRequest || isPublisherMemberCreate || isPublisherMemberAction || isPublisherKeyAction || isReviewerSubmissionDetail || isReviewerSubmissionReview) && !session) return NextResponse.json({ error: 'Marketplace sign-in required' }, { status: 401 });
  const target = new URL(`/v1/${path}`, marketplaceUrl());
  if (method === 'GET') request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const requestContentType = request.headers.get('content-type') || '';
  const isMultipart = method === 'POST' && requestContentType.toLowerCase().includes('multipart/form-data');
  let requestBody: BodyInit | undefined;
  if (method === 'POST') requestBody = isMultipart ? await request.formData() : await request.text();
  if (method === 'POST' && session && (path === 'sessions/revoke' || path === 'sessions/refresh')) requestBody = JSON.stringify({ sessionToken: session });
  const upstream = await fetch(target, {
    method, redirect: 'manual', cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(method === 'POST' && !isMultipart ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: requestBody } : {}),
  });
  if (protectedArtifact) {
    const headers = new Headers();
    for (const name of ['content-type', 'content-disposition', 'content-length', 'etag', 'cache-control']) {
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }
  const body = await upstream.json().catch(() => ({ error: 'Marketplace returned invalid JSON' }));
  if (path === 'sessions' && upstream.ok && body.status === 'authenticated' && body.sessionToken) {
    const responseBody = { ...body }; delete responseBody.sessionToken;
    const response = NextResponse.json(responseBody, { status: upstream.status });
    response.cookies.set(SESSION_COOKIE, body.sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: body.expiresAt ? new Date(body.expiresAt) : undefined });
    return response;
  }
  if (path === 'sessions/refresh' && upstream.ok && body.sessionToken) {
    const response = NextResponse.json({ refreshed: true, expiresAt: body.expiresAt }, { status: upstream.status });
    response.cookies.set(SESSION_COOKIE, body.sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: body.expiresAt ? new Date(body.expiresAt) : undefined });
    return response;
  }
  if (path === 'sessions/revoke' && upstream.ok) {
    const response = NextResponse.json(body, { status: upstream.status });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  return NextResponse.json(body, { status: upstream.status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try { return proxy(request, (await context.params).path, 'GET'); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Marketplace unavailable' }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try { return proxy(request, (await context.params).path, 'POST'); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Marketplace unavailable' }, { status: 503 }); }
}
