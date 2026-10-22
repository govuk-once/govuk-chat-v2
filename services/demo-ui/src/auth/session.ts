import { sealData, unsealData } from 'iron-session';
import type { NextRequest, NextResponse } from 'next/server';
import { requireEnv } from '../lib/env.ts';
import { setHttpOnlyCookie } from '../lib/http-only-cookie.ts';
import type { SignInFlow } from './cognito-sign-in.ts';
import { CALLBACK_PATH } from './urls.ts';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

const SIGN_IN_FLOW_COOKIE = 'sign_in_flow';
// 10 minutes is long enough to sign in at the Hosted UI, short enough that an
// abandoned sign-in doesn't linger.
const SIGN_IN_FLOW_MAX_AGE_SECONDS = 10 * 60;

type RequestCookies = Pick<NextRequest['cookies'], 'get'>;

// iron stamps the expiry into the seal, and checks it when unsealing.
function seal(data: object, ttl: number): Promise<string> {
  return sealData(data, { password: requireEnv('SESSION_SECRET'), ttl });
}

function unseal<T>(cookie: string): Promise<Partial<T>> {
  return unsealData<Partial<T>>(cookie, {
    password: requireEnv('SESSION_SECRET'),
  });
}

export async function readSession(
  cookies: RequestCookies,
): Promise<{ sub: string } | undefined> {
  const cookie = cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return undefined;
  const { sub } = await unseal<{ sub: string }>(cookie);
  return sub ? { sub } : undefined;
}

export async function setSession(
  response: NextResponse,
  sub: string,
): Promise<void> {
  setHttpOnlyCookie(
    response,
    SESSION_COOKIE,
    await seal({ sub }, SESSION_MAX_AGE_SECONDS),
    { maxAge: SESSION_MAX_AGE_SECONDS },
  );
}

export async function readSignInFlow(
  cookies: RequestCookies,
): Promise<SignInFlow | undefined> {
  const cookie = cookies.get(SIGN_IN_FLOW_COOKIE)?.value;
  if (!cookie) return undefined;
  const { codeVerifier, state, returnPath } = await unseal<SignInFlow>(cookie);
  return codeVerifier && state && returnPath
    ? { codeVerifier, state, returnPath }
    : undefined;
}

export async function setSignInFlow(
  response: NextResponse,
  flow: SignInFlow,
): Promise<void> {
  setHttpOnlyCookie(
    response,
    SIGN_IN_FLOW_COOKIE,
    await seal(flow, SIGN_IN_FLOW_MAX_AGE_SECONDS),
    { path: CALLBACK_PATH, maxAge: SIGN_IN_FLOW_MAX_AGE_SECONDS },
  );
}

export function clearSignInFlow(response: NextResponse): void {
  response.cookies.delete({ name: SIGN_IN_FLOW_COOKIE, path: CALLBACK_PATH });
}
