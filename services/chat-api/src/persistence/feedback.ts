import type { WhereAttributeSymbol } from 'electrodb';
import {
  cancellationCodes,
  RETENTION_PERIOD_IN_SECONDS,
  service,
} from './service.ts';

export interface FeedbackKey {
  systemThreadId: string;
  messageId: string;
}

export type Reaction = 'positive' | 'negative';

export interface MessageFeedback {
  reaction: Reaction;
  createdAt: string;
}

export type FeedbackOutcome =
  | { status: 'recorded' }
  | { status: 'message-not-found' }
  | { status: 'already-provided' };

interface FeedbackTargetRecord {
  role: WhereAttributeSymbol<string>;
  expiresAt: WhereAttributeSymbol<number>;
}

interface FeedbackTargetOperations {
  eq: (attribute: WhereAttributeSymbol<string>, value: string) => string;
  gt: (attribute: WhereAttributeSymbol<number>, value: number) => string;
}

// Both comparisons fail when the message is absent, so no exists check is
// needed alongside them.
function unexpiredAssistantMessage(nowSeconds: number) {
  return (
    attribute: FeedbackTargetRecord,
    operation: FeedbackTargetOperations,
  ): string =>
    `${operation.gt(attribute.expiresAt, nowSeconds)} AND ${operation.eq(attribute.role, 'assistant')}`;
}

export async function recordFeedback(
  key: FeedbackKey,
  reaction: Reaction,
): Promise<FeedbackOutcome> {
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const { systemThreadId, messageId } = key;

  const result = await service.transaction
    .write(({ message, feedback }) => [
      message
        .check({ systemThreadId, messageId })
        .where(unexpiredAssistantMessage(nowSeconds))
        .commit(),
      feedback
        .create({
          systemThreadId,
          messageId,
          reaction,
          createdAt: now.toISOString(),
          expiresAt: nowSeconds + RETENTION_PERIOD_IN_SECONDS,
        })
        .commit(),
    ])
    .go();

  if (!result.canceled) {
    return { status: 'recorded' };
  }

  const codes = cancellationCodes(result.data);
  const [messageCode, feedbackCode] = codes;

  if (messageCode === 'ConditionalCheckFailed') {
    return { status: 'message-not-found' };
  }
  if (
    feedbackCode === 'ConditionalCheckFailed' ||
    codes.includes('TransactionConflict')
  ) {
    return { status: 'already-provided' };
  }
  throw new Error(`Feedback recording was cancelled: ${codes.join(', ')}`);
}

export async function readFeedback(
  systemThreadId: string,
  messageIds: readonly string[],
): Promise<Map<string, MessageFeedback>> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const { data, unprocessed } = await service.entities.feedback
    .get(messageIds.map((messageId) => ({ systemThreadId, messageId })))
    .go({ consistent: true });
  if (unprocessed.length > 0) {
    throw new Error(
      `Feedback read left ${unprocessed.length} keys unprocessed`,
    );
  }

  return new Map(
    data.map(({ messageId, reaction, createdAt }) => [
      messageId,
      { reaction, createdAt },
    ]),
  );
}
