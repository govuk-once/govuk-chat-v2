import type { NextRequest } from 'next/server';

export const CALLBACK_PATH = '/api/auth/callback';

// Behind the load balancer, the request's own URL is the container's, so the
// public origin comes from the forwarded headers.
export function appOrigin(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

export function callbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}${CALLBACK_PATH}`;
}
