import { NextResponse, type NextRequest } from 'next/server';
import { startSignIn } from './auth/cognito-sign-in.ts';
import { readSession, setSignInFlow } from './auth/session.ts';
import { callbackUrl } from './auth/urls.ts';

export const config = {
  matcher: [
    // eslint-disable-next-line unicorn/prefer-string-raw -- Next.js requires a plain string literal for static analysis
    '/((?!api/health|api/auth/callback|_next/static|_next/image|favicon\\.ico).*)',
  ],
};

async function redirectToSignIn(request: NextRequest): Promise<NextResponse> {
  const { url, flow } = await startSignIn(
    callbackUrl(request),
    request.nextUrl.pathname + request.nextUrl.search,
  );

  const response = NextResponse.redirect(url);
  await setSignInFlow(response, flow);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const session = await readSession(request.cookies);
  if (session) {
    return NextResponse.next();
  }

  // A fetch that follows the redirect to the Hosted UI fails on CORS, so API
  // callers get a status they can act on instead.
  return request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    : redirectToSignIn(request);
}
