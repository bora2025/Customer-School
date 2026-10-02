import { NextRequest, NextResponse } from 'next/server';

// Ensure this route is always dynamic (never cached by Next.js)
export const dynamic = 'force-dynamic';

/** Runtime API proxy — forwards /api/* requests to the backend */
function getBackendUrl(): string {
  let url = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  // Ensure protocol is present
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  // Remove trailing slash
  return url.replace(/\/+$/, '');
}

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendUrl = getBackendUrl();
  const target = `${backendUrl}/${path.join('/')}`;

  // Forward query string
  const url = new URL(req.url);
  const qs = url.search;

  const headers = new Headers(req.headers);
  // Remove headers that conflict with the proxy layer
  headers.delete('host');
  headers.delete('accept-encoding');

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
    // @ts-ignore - duplex needed for streaming request bodies
    duplex: 'half',
  };

  // Forward body for non-GET/HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fetchOptions.body = req.body;
  }

  try {
    const response = await fetch(`${target}${qs}`, { ...fetchOptions, cache: 'no-store' });

    // Forward all response headers including Set-Cookie
    // Strip content-encoding & content-length because fetch() auto-decompresses
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') return;
      responseHeaders.append(key, value);
    });

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('API proxy error:', error);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 });
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
