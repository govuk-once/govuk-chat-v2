import { sealData, unsealData } from 'iron-session';
import { requireEnv } from '../lib/env.ts';
import type { SignInFlow } from './oidc.ts';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export const SIGN_IN_FLOW_COOKIE = 'sign_in_flow';
// Long enough to sign in at the Hosted UI, short enough that an abandoned
// sign-in doesn't linger.
export const SIGN_IN_FLOW_MAX_AGE_SECONDS = 10 * 60;

// iron-session encrypts and signs the cookie, and checks its age when it's
// opened; anything tampered with or expired opens as empty.
function seal(data: object, ttl: number): Promise<string> {
  return sealData(data, { password: requireEnv('SESSION_SECRET'), ttl });
}

function unseal<T>(cookie: string, ttl: number): Promise<Partial<T>> {
  return unsealData<Partial<T>>(cookie, {
    password: requireEnv('SESSION_SECRET'),
    ttl,
  });
}

export function createSessionCookie(sub: string): Promise<string> {
  return seal({ sub }, SESSION_MAX_AGE_SECONDS);
}

export async function verifySession(
  cookie: string | undefined,
): Promise<{ sub: string } | undefined> {
  if (!cookie) return undefined;
  const { sub } = await unseal<{ sub: string }>(
    cookie,
    SESSION_MAX_AGE_SECONDS,
  );
  return sub ? { sub } : undefined;
}

export function sealSignInFlow(flow: SignInFlow): Promise<string> {
  return seal(flow, SIGN_IN_FLOW_MAX_AGE_SECONDS);
}

export async function openSignInFlow(
  cookie: string | undefined,
): Promise<SignInFlow | undefined> {
  if (!cookie) return undefined;
  const flow = await unseal<SignInFlow>(cookie, SIGN_IN_FLOW_MAX_AGE_SECONDS);
  const { codeVerifier, state, returnPath } = flow;
  return codeVerifier && state && returnPath
    ? { codeVerifier, state, returnPath }
    : undefined;
}
