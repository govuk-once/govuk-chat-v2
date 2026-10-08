import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { finishSignIn } from '../../../../auth/oidc.ts';
import {
  createSessionCookie,
  openSignInFlow,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SIGN_IN_FLOW_COOKIE,
} from '../../../../auth/session.ts';
import { appOrigin, callbackUrl } from '../../../../auth/urls.ts';

const uuidSchema = z.uuid();

// The return path is the page the user first asked for, which could be a
// path like //evil.example that a browser treats as another site.
function safeReturnPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return '/';
  }
  return path;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const flow = await openSignInFlow(
    request.cookies.get(SIGN_IN_FLOW_COOKIE)?.value,
  );
  if (!flow) {
    return NextResponse.json(
      { error: 'Sign-in expired, please try again' },
      { status: 400 },
    );
  }

  // Behind the load balancer the request's own URL is the container's, so
  // the URL Cognito redirected to is rebuilt from the forwarded headers.
  const sub = await finishSignIn(
    new URL(`${callbackUrl(request)}${request.nextUrl.search}`),
    flow,
  );
  // The sub becomes the Chat API's end-user-id, which must be a UUID. Cognito
  // documents it as one, so a mismatch is a server fault worth failing on
  // here rather than on the user's first message.
  if (!uuidSchema.safeParse(sub).success) {
    throw new Error('Cognito sub is not a UUID');
  }

  const response = NextResponse.redirect(
    new URL(safeReturnPath(flow.returnPath), appOrigin(request)),
  );
  response.cookies.set(SESSION_COOKIE, await createSessionCookie(sub), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.delete({
    name: SIGN_IN_FLOW_COOKIE,
    path: '/api/auth/callback',
  });
  return response;
}
