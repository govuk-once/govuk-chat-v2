import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { setHttpOnlyCookie } from './http-only-cookie.ts';

describe('setHttpOnlyCookie', () => {
  it('sets a cookie that is not secure outside production', () => {
    const response = new NextResponse();

    setHttpOnlyCookie(response, 'example', 'value', { maxAge: 60 });

    expect(response.cookies.get('example')).toMatchObject({
      value: 'value',
      secure: false,
    });
  });

  it('sets a secure cookie in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = new NextResponse();

    setHttpOnlyCookie(response, 'example', 'value', { maxAge: 60 });

    expect(response.cookies.get('example')?.secure).toBe(true);
  });
});
