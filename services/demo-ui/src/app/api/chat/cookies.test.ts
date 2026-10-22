import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { clearThreadId, readThreadId, setThreadId } from './cookies.ts';

const THREAD_ID = crypto.randomUUID();

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
  it('sets the thread cookie', () => {
    const response = new NextResponse();

    setThreadId(response, THREAD_ID);

    expect(response.cookies.get('thread_id')?.value).toBe(THREAD_ID);
  });
});

describe('clearThreadId', () => {
  it('clears the thread cookie', () => {
    const response = new NextResponse();

    clearThreadId(response);

    expect(response.cookies.get('thread_id')?.value).toBe('');
  });
});
