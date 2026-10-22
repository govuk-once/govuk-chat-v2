import type { NextResponse } from 'next/server';

export function setHttpOnlyCookie(
  response: NextResponse,
  name: string,
  value: string,
  { maxAge, path = '/' }: { maxAge: number; path?: string },
): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path,
    maxAge,
  });
}
