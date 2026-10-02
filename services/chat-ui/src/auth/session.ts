import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'session';
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

interface SessionPayload {
  sub: string;
  exp: number;
}

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionCookie(sub: string): string {
  const secret = requireSessionSecret();
  const payload: SessionPayload = {
    sub,
    exp: Date.now() + SESSION_LIFETIME_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifySession(
  cookie: string | undefined,
): { sub: string } | undefined {
  if (!cookie) return undefined;

  const secret = requireSessionSecret();
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
