import { z } from 'zod';

const INVALID_CURSOR_MESSAGE = 'cursor must be a valid cursor';

const TurnCursorPayloadSchema = z.strictObject({
  direction: z.enum(['before', 'after']),
  createdAt: z.iso.datetime(),
  turnId: z.uuid(),
});

type TurnCursorPayload = z.infer<typeof TurnCursorPayloadSchema>;
type TurnEdge = Pick<TurnCursorPayload, 'createdAt' | 'turnId'>;

export class TurnCursor {
  static before({ createdAt, turnId }: TurnEdge): TurnCursor {
    return new TurnCursor({ direction: 'before', createdAt, turnId });
  }

  static after({ createdAt, turnId }: TurnEdge): TurnCursor {
    return new TurnCursor({ direction: 'after', createdAt, turnId });
  }

  readonly direction: TurnCursorPayload['direction'];
  readonly createdAt: string;
  readonly turnId: string;

  constructor({ direction, createdAt, turnId }: TurnCursorPayload) {
    this.direction = direction;
    this.createdAt = createdAt;
    this.turnId = turnId;
  }

  toString(): string {
    const payload: TurnCursorPayload = {
      direction: this.direction,
      createdAt: this.createdAt,
      turnId: this.turnId,
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }
}

export const TurnCursorSchema = z
  .base64url({ message: INVALID_CURSOR_MESSAGE })
  .transform((token, context): TurnCursor => {
    try {
      const json: unknown = JSON.parse(
        Buffer.from(token, 'base64url').toString('utf8'),
      );
      return new TurnCursor(TurnCursorPayloadSchema.parse(json));
    } catch {
      context.addIssue({ code: 'custom', message: INVALID_CURSOR_MESSAGE });
      return z.NEVER;
    }
  });
