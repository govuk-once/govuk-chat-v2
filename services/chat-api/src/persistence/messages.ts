import { service } from './service.ts';
import type { ThreadKey, ResolvedThread } from './threads.ts';
import type { Reaction } from './feedback.ts';
import { Cursor } from '../schemas/message-cursor.ts';

export interface MessageFeedback {
  reaction: Reaction;
  createdAt: string;
}

export interface StoredMessage {
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
  feedback?: MessageFeedback;
}

export interface MessagePage {
  messages: StoredMessage[];
  earlier?: Cursor;
  later?: Cursor;
}

export async function lookupThread(
  key: ThreadKey,
): Promise<ResolvedThread | undefined> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const { data: mapping } = await service.entities.threadMapping
    .get(key)
    .go({ consistent: true });

  return !mapping || mapping.expiresAt <= nowSeconds
    ? undefined
    : { systemThreadId: mapping.systemThreadId };
}

function toStoredMessage(record: StoredMessage): StoredMessage {
  return {
    messageId: record.messageId,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
  };
}

export const MESSAGE_PAGE_SIZE = 100;

function queryFrom(systemThreadId: string, from?: Cursor) {
  const query = service.entities.message.query.byCreatedAt({ systemThreadId });
  if (!from) {
    return query;
  }
  const { createdAt, messageId } = from;
  return from.direction === 'before'
    ? query.lt({ createdAt, messageId })
    : query.gt({ createdAt, messageId });
}

async function readFeedbackByMessageId(
  systemThreadId: string,
  messages: readonly StoredMessage[],
): Promise<Map<string, MessageFeedback>> {
  const keys = messages
    .filter((message) => message.role === 'assistant')
    .map(({ messageId }) => ({ systemThreadId, messageId }));
  if (keys.length === 0) {
    return new Map();
  }

  const { data, unprocessed } = await service.entities.feedback
    .get(keys)
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

function withFeedback(
  message: StoredMessage,
  feedbackByMessageId: ReadonlyMap<string, MessageFeedback>,
): StoredMessage {
  const feedback = feedbackByMessageId.get(message.messageId);
  return feedback ? { ...message, feedback } : message;
}

export async function getMessagePage(
  systemThreadId: string,
  from?: Cursor,
): Promise<MessagePage> {
  const isAscending = from?.direction === 'after';
  const { data: records } = await queryFrom(systemThreadId, from).go({
    order: isAscending ? 'asc' : 'desc',
    limit: MESSAGE_PAGE_SIZE + 1,
    count: MESSAGE_PAGE_SIZE + 1,
  });

  const hasMoreInPagedDirection = records.length > MESSAGE_PAGE_SIZE;
  const read = records
    .slice(0, MESSAGE_PAGE_SIZE)
    .map((record) => toStoredMessage(record));
  const ordered = isAscending ? read : read.toReversed();
  const feedbackByMessageId = await readFeedbackByMessageId(
    systemThreadId,
    ordered,
  );
  const messages = ordered.map((message) =>
    withFeedback(message, feedbackByMessageId),
  );

  const oldest = messages.at(0);
  const newest = messages.at(-1);
  if (!oldest || !newest) {
    return { messages };
  }

  // A page reached from a cursor always has the cursor's message on the
  // side it came from, so only the paged direction needs the extra read.
  const hasEarlier = isAscending || hasMoreInPagedDirection;
  const hasLater =
    from !== undefined && (!isAscending || hasMoreInPagedDirection);

  return {
    messages,
    ...(hasEarlier && { earlier: Cursor.before(oldest) }),
    ...(hasLater && { later: Cursor.after(newest) }),
  };
}
