import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from './auth/session.ts';
import { callbackUrl } from './auth/urls.ts';
import { requireEnv } from './env.ts';

export const config = {
  matcher: [
    // eslint-disable-next-line unicorn/prefer-string-raw -- Next.js requires a plain string literal for static analysis
    '/((?!api/health|api/auth/callback|_next/static|_next/image|favicon\\.ico).*)',
  ],
};

function buildAuthorizeUrl(request: NextRequest): string {
  const authorizeUrl = requireEnv('COGNITO_TOKEN_ENDPOINT').replace(
    '/oauth2/token',
    '/oauth2/authorize',
  );
  const parameters = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('COGNITO_SIGN_IN_CLIENT_ID'),
    redirect_uri: callbackUrl(request),
    scope: 'openid',
    state: request.nextUrl.pathname + request.nextUrl.search,
  });

  return `${authorizeUrl}?${parameters}`;
}

export function proxy(request: NextRequest): NextResponse {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);

  if (session) {
    return NextResponse.next();
  }

  // A fetch that follows the redirect to the Hosted UI fails on CORS, so API
  // callers get a status they can act on instead.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return NextResponse.redirect(buildAuthorizeUrl(request));
}
