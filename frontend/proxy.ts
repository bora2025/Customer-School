import { NextRequest, NextResponse } from 'next/server';
import { frontendDistribution } from './lib/navigation-registry';
import { isRouteAvailable } from './lib/route-policy';

/** Next 16 request boundary: direct URLs cannot bypass distribution-aware navigation. */
export function proxy(request: NextRequest) {
  const distribution = frontendDistribution(
    process.env.NEXT_PUBLIC_WATTANAM_DISTRIBUTION ?? process.env.WATTANAM_DISTRIBUTION,
  );
  if (isRouteAvailable(request.nextUrl.pathname, distribution)) return NextResponse.next();

  const notFound = request.nextUrl.clone();
  notFound.pathname = '/_not-found';
  return NextResponse.rewrite(notFound, { status: 404 });
}

export const config = {
  matcher: '/:path*',
};

