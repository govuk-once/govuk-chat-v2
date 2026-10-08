import { NextResponse, type NextRequest } from 'next/server';
import { startSignIn } from './auth/oidc.ts';
import {
  sealSignInFlow,
  SESSION_COOKIE,
  SIGN_IN_FLOW_COOKIE,
  SIGN_IN_FLOW_MAX_AGE_SECONDS,
  verifySession,
} from './auth/session.ts';
import { callbackUrl } from './auth/urls.ts';

export const config = {
  matcher: [
    // eslint-disable-next-line unicorn/prefer-string-raw -- Next.js requires a plain string literal for static analysis
    '/((?!api/health|api/auth/callback|_next/static|_next/image|favicon\\.ico).*)',
  ],
};

// The PKCE verifier and state the callback checks travel in a sealed cookie,
// along with the page to return to.
async function redirectToSignIn(request: NextRequest): Promise<NextResponse> {
  const { url, flow } = await startSignIn(
    callbackUrl(request),
    request.nextUrl.pathname + request.nextUrl.search,
  );

  const response = NextResponse.redirect(url);
  response.cookies.set(SIGN_IN_FLOW_COOKIE, await sealSignInFlow(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/callback',
    maxAge: SIGN_IN_FLOW_MAX_AGE_SECONDS,
  });
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (session) {
    return NextResponse.next();
  }

  // A fetch that follows the redirect to the Hosted UI fails on CORS, so API
  // callers get a status they can act on instead.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return redirectToSignIn(request);
}
