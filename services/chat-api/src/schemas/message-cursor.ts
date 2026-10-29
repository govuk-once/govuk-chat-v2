import { z } from 'zod';

const INVALID_CURSOR_MESSAGE = 'cursor must be a valid cursor';

const CursorPayloadSchema = z.strictObject({
  direction: z.enum(['before', 'after']),
  createdAt: z.iso.datetime(),
  messageId: z.uuid(),
});

type CursorPayload = z.infer<typeof CursorPayloadSchema>;
type MessageEdge = Pick<CursorPayload, 'createdAt' | 'messageId'>;

export class Cursor {
  static before({ createdAt, messageId }: MessageEdge): Cursor {
    return new Cursor({ direction: 'before', createdAt, messageId });
  }

  static after({ createdAt, messageId }: MessageEdge): Cursor {
    return new Cursor({ direction: 'after', createdAt, messageId });
  }

  readonly direction: CursorPayload['direction'];
  readonly createdAt: string;
  readonly messageId: string;

  constructor({ direction, createdAt, messageId }: CursorPayload) {
    this.direction = direction;
    this.createdAt = createdAt;
    this.messageId = messageId;
  }

  toString(): string {
    const payload: CursorPayload = {
      direction: this.direction,
      createdAt: this.createdAt,
      messageId: this.messageId,
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }
}

export const CursorSchema = z
  .base64url({ message: INVALID_CURSOR_MESSAGE })
  .transform((token, context): Cursor => {
    try {
      const json: unknown = JSON.parse(
        Buffer.from(token, 'base64url').toString('utf8'),
      );
      return new Cursor(CursorPayloadSchema.parse(json));
    } catch {
      context.addIssue({ code: 'custom', message: INVALID_CURSOR_MESSAGE });
      return z.NEVER;
    }
  });
