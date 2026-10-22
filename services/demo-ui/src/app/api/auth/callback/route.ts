import { NextResponse, type NextRequest } from 'next/server';
import { finishSignIn } from '../../../../auth/cognito-sign-in.ts';
import {
  clearSignInFlow,
  readSignInFlow,
  setSession,
} from '../../../../auth/session.ts';
import { appOrigin, callbackUrl } from '../../../../auth/urls.ts';

// The return path is the page the user first asked for, which could be a
// path like //evil.example that a browser treats as another site.
function returnUrl(returnPath: string, origin: URL): URL {
  const url = new URL(returnPath, origin);
  return url.origin === origin.origin ? url : new URL('/', origin);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const flow = await readSignInFlow(request.cookies);
  if (!flow) {
    return NextResponse.json(
      { error: 'Sign-in expired, please try again' },
      { status: 400 },
    );
  }

  const sub = await finishSignIn(
    new URL(`${callbackUrl(request)}${request.nextUrl.search}`),
    flow,
  );

  const origin = new URL(appOrigin(request));
  const response = NextResponse.redirect(returnUrl(flow.returnPath, origin));
  await setSession(response, sub);
  clearSignInFlow(response);
  return response;
}
