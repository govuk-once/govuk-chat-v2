import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from './auth/session.ts';

export const config = {
  matcher: [
    String.raw`/((?!api/health|api/auth/callback|_next/static|_next/image|favicon\.ico).*)`,
  ],
};

function buildAuthorizeUrl(request: NextRequest): string {
  const tokenEndpoint = process.env.COGNITO_TOKEN_ENDPOINT ?? '';
  const authorizeUrl = tokenEndpoint.replace(
    '/oauth2/token',
    '/oauth2/authorize',
  );
  const clientId = process.env.COGNITO_SIGN_IN_CLIENT_ID ?? '';

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http';
  const redirectUri = `${protocol}://${host}/api/auth/callback`;

  const parameters = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid',
    state: request.nextUrl.pathname,
  });

  return `${authorizeUrl}?${parameters}`;
}

export function middleware(request: NextRequest): NextResponse {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);

  if (session) {
    return NextResponse.next();
  }

  return NextResponse.redirect(buildAuthorizeUrl(request));
}
