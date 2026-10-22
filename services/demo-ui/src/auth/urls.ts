import type { NextRequest } from 'next/server';

export const CALLBACK_PATH = '/api/auth/callback';

// Behind the load balancer, the request's own URL is the container's. The
// load balancer passes the Host header on and sets X-Forwarded-Proto, so the
// public origin comes from those. It doesn't set X-Forwarded-Host, so that
// header would be whatever the client sent.
export function appOrigin(request: NextRequest): string {
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

export function callbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}${CALLBACK_PATH}`;
}
