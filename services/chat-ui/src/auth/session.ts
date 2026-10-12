import { sealData, unsealData } from 'iron-session';
import type { NextRequest, NextResponse } from 'next/server';
import { requireEnv } from '../lib/env.ts';
import { setHttpOnlyCookie } from '../lib/http-only-cookie.ts';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

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
