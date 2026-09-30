import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const THREAD_ID_COOKIE = 'thread_id';
const END_USER_ID_COOKIE = 'end_user_id';

// As in Chat V1, where the conversation cookie lasts 90 days from last use.
const MAX_AGE_SECONDS = 7_776_000;

const uuidSchema = z.uuid();

type RequestCookies = Pick<NextRequest['cookies'], 'get'>;

// The API accepts only UUIDs, so any other value is ignored.
function readUuidCookie(
  cookies: RequestCookies,
  name: string,
): string | undefined {
  const result = uuidSchema.safeParse(cookies.get(name)?.value);
  return result.success ? result.data : undefined;
}

function setCookie(response: NextResponse, name: string, value: string): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function readThreadId(cookies: RequestCookies): string | undefined {
  return readUuidCookie(cookies, THREAD_ID_COOKIE);
}

export function setThreadId(response: NextResponse, threadId: string): void {
  setCookie(response, THREAD_ID_COOKIE, threadId);
}

export function clearThreadId(response: NextResponse): void {
  response.cookies.delete(THREAD_ID_COOKIE);
}

export function readEndUserId(cookies: RequestCookies): string | undefined {
  return readUuidCookie(cookies, END_USER_ID_COOKIE);
}

export function setEndUserId(response: NextResponse, endUserId: string): void {
  setCookie(response, END_USER_ID_COOKIE, endUserId);
}
