import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  clearThreadId,
  readEndUserId,
  readThreadId,
  setEndUserId,
  setThreadId,
} from './cookies.ts';

const THREAD_ID = crypto.randomUUID();
const END_USER_ID = crypto.randomUUID();

function requestCookies(cookie: string): NextRequest['cookies'] {
  return new NextRequest('http://localhost/', { headers: { cookie } }).cookies;
}

describe('readThreadId', () => {
  it('returns the thread id from the cookie', () => {
    expect(readThreadId(requestCookies(`thread_id=${THREAD_ID}`))).toBe(
      THREAD_ID,
    );
  });

  it('ignores a cookie that is not a UUID', () => {
    expect(
      readThreadId(requestCookies('thread_id=../../other')),
    ).toBeUndefined();
  });
});

describe('setThreadId', () => {
  it('sets a cookie that is not secure outside production', () => {
    const response = new NextResponse();

    setThreadId(response, THREAD_ID);

    expect(response.cookies.get('thread_id')).toMatchObject({
      value: THREAD_ID,
      secure: false,
    });
  });

  it('sets a secure cookie in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = new NextResponse();

    setThreadId(response, THREAD_ID);

    expect(response.cookies.get('thread_id')?.secure).toBe(true);
  });
});

describe('clearThreadId', () => {
  it('clears the thread cookie', () => {
    const response = new NextResponse();

    clearThreadId(response);

    expect(response.cookies.get('thread_id')?.value).toBe('');
  });
});

describe('readEndUserId', () => {
  it('returns the end user id from the cookie', () => {
    expect(readEndUserId(requestCookies(`end_user_id=${END_USER_ID}`))).toBe(
      END_USER_ID,
    );
  });

  it('ignores a cookie that is not a UUID', () => {
    expect(
      readEndUserId(requestCookies('end_user_id=../../other')),
    ).toBeUndefined();
  });
});

describe('setEndUserId', () => {
  it('sets the end user cookie', () => {
    const response = new NextResponse();

    setEndUserId(response, END_USER_ID);

    expect(response.cookies.get('end_user_id')?.value).toBe(END_USER_ID);
  });
});
