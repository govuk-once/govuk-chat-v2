import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setHttpOnlyCookie } from '../../../lib/http-only-cookie.ts';

const THREAD_ID_COOKIE = 'thread_id';

// As in Chat V1, where the conversation cookie lasts 90 days from last use.
const MAX_AGE_SECONDS = 7_776_000;

const uuidSchema = z.uuid();

type RequestCookies = Pick<NextRequest['cookies'], 'get'>;

// The API accepts only UUIDs, so any other value is ignored.
export function readThreadId(cookies: RequestCookies): string | undefined {
  const result = uuidSchema.safeParse(cookies.get(THREAD_ID_COOKIE)?.value);
  return result.success ? result.data : undefined;
}

export function setThreadId(response: NextResponse, threadId: string): void {
  setHttpOnlyCookie(response, THREAD_ID_COOKIE, threadId, {
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearThreadId(response: NextResponse): void {
  response.cookies.delete(THREAD_ID_COOKIE);
}
