import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv } from '../env.ts';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionCookie(sub: string): string {
  const secret = requireEnv('SESSION_SECRET');
  const payload: SessionPayload = {
    sub,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifySession(
  cookie: string | undefined,
): { sub: string } | undefined {
  if (!cookie) return undefined;

  const secret = requireEnv('SESSION_SECRET');
  const dotIndex = cookie.indexOf('.');
  if (dotIndex === -1) return undefined;

  const encoded = cookie.slice(0, dotIndex);
  const providedSignature = cookie.slice(dotIndex + 1);

  const expectedSignature = sign(encoded, secret);
  if (providedSignature.length !== expectedSignature.length) return undefined;

  const signaturesMatch = timingSafeEqual(
    Buffer.from(providedSignature),
    Buffer.from(expectedSignature),
  );
  if (!signaturesMatch) return undefined;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString(),
    ) as SessionPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      return undefined;
    }
    if (Date.now() >= payload.exp) return undefined;
    return { sub: payload.sub };
  } catch {
    return undefined;
  }
}
