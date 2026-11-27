import type { NextRequest } from 'next/server';

export const CALLBACK_PATH = '/api/auth/callback';

// The request's own URL is the local server's, so the public origin comes
// from the Host header, which the web function endpoint passes on. The
// endpoint only serves HTTPS but doesn't set X-Forwarded-Proto, and passes
// any X-Forwarded-* header from the client unchecked, so the protocol isn't
// read from the request: only `next dev` on localhost serves plain HTTP.
export function appOrigin(request: NextRequest): string {
  const host = request.headers.get('host');
  const protocol = host?.split(':', 1)[0] === 'localhost' ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function callbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}${CALLBACK_PATH}`;
}
