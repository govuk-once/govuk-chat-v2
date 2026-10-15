import { service } from './service.ts';
import type { ThreadKey, ResolvedThread } from './threads.ts';

export interface StoredMessage {
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface MessagePage {
  messages: StoredMessage[];
  oldestMessageId: string | undefined;
}

export async function lookupThread(
  key: ThreadKey,
): Promise<ResolvedThread | undefined> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const { data: mapping } = await service.entities.threadMapping
    .get(key)
    .go({ consistent: true });

  if (!mapping || mapping.expiresAt <= nowSeconds) {
    return undefined;
  }

  return { systemThreadId: mapping.systemThreadId };
}

export async function getMessages(
  systemThreadId: string,
): Promise<StoredMessage[]> {
  const { data: records } = await service.entities.message.query
    .primary({ systemThreadId })
    .go();

  return records.map((record) => ({
    messageId: record.messageId,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
  }));
}

export const MESSAGE_PAGE_SIZE = 50;

function compareMessages(a: StoredMessage, b: StoredMessage): number {
  const dateCompare = a.createdAt.localeCompare(b.createdAt);
  if (dateCompare !== 0) return dateCompare;
  return a.messageId.localeCompare(b.messageId);
}

export function sliceMessages(
  messages: StoredMessage[],
  before?: string,
): MessagePage {
  const sorted = messages.toSorted(compareMessages);

  let endIndex = sorted.length;
  if (before) {
    endIndex = sorted.findIndex((m) => m.messageId === before);
    if (endIndex === -1) {
      return { messages: [], oldestMessageId: undefined };
    }
  }

  const startIndex = Math.max(0, endIndex - MESSAGE_PAGE_SIZE);
  const page = sorted.slice(startIndex, endIndex);
  const hasEarlier = startIndex > 0;

  return {
    messages: page,
    oldestMessageId: hasEarlier ? page[0].messageId : undefined,
  };
}
