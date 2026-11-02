import { describe, expect, it } from 'vitest';
import { Cursor, CursorSchema } from './message-cursor.ts';

const POSITION = {
  createdAt: '2026-10-21T09:30:00.123Z',
  messageId: crypto.randomUUID(),
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('Cursor', () => {
  it.each(['before', 'after'] as const)(
    'round-trips a %s cursor through CursorSchema',
    (direction) => {
      const cursor = Cursor[direction](POSITION);

      const result = CursorSchema.safeParse(cursor.toString());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(cursor);
    },
  );

  it('encodes only the direction and the message position', () => {
    const token = Cursor.before(POSITION).toString();

    const payload: unknown = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    );

    expect(payload).toEqual({ direction: 'before', ...POSITION });
  });
});

describe('CursorSchema', () => {
  const valid = { direction: 'before', ...POSITION };

  it.each([
    ['is not base64url', 'not+base64url='],
    ['is not JSON', Buffer.from('not json').toString('base64url')],
    ['has an unknown direction', encodeJson({ ...valid, direction: 'up' })],
    [
      'has an invalid createdAt',
      encodeJson({ ...valid, createdAt: 'yesterday' }),
    ],
    [
      'has an invalid messageId',
      encodeJson({ ...valid, messageId: 'not-a-uuid' }),
    ],
    ['has an extra key', encodeJson({ ...valid, systemThreadId: 'abc' })],
  ])('rejects a token that %s', (_, token) => {
    expect(CursorSchema.safeParse(token).success).toBe(false);
  });
});
