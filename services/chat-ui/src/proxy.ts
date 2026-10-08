import { NextResponse, type NextRequest } from 'next/server';
import { getAuth, signedInSub } from './auth/auth.ts';

export const config = {
  matcher: [
    // eslint-disable-next-line unicorn/prefer-string-raw -- Next.js requires a plain string literal for static analysis
    '/((?!api/health|api/auth/|_next/static|_next/image|favicon\\.ico).*)',
  ],
};

// Sign-in is started here rather than from the page, so a signed-out user is
// sent straight to the Hosted UI. Better Auth sets a state cookie that the
// callback checks, which has to travel with the redirect.
async function redirectToSignIn(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuth();
  const { headers, response } = await auth.api.signInSocial({
    body: {
      provider: 'cognito',
      callbackURL: request.nextUrl.pathname + request.nextUrl.search,
      disableRedirect: true,
    },
    headers: request.headers,
    returnHeaders: true,
  });
  if (!response.url) {
    throw new Error('Better Auth returned no sign-in URL');
  }

  const redirect = NextResponse.redirect(response.url);
  for (const cookie of headers.getSetCookie()) {
    redirect.headers.append('Set-Cookie', cookie);
  }
  return redirect;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (await signedInSub(request.headers)) {
    return NextResponse.next();
  }

  // A fetch that follows the redirect to the Hosted UI fails on CORS, so API
  // callers get a status they can act on instead.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return redirectToSignIn(request);
}
