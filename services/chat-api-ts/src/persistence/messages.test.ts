import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { send, stubDynamoDBDocumentClient } from '../test-utils/dynamodb.ts';
import type {
  lookupThread,
  getMessages,
  sliceMessages,
  StoredMessage,
} from './messages.ts';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const KEY = { endUserId: 'user-1', userThreadId: 'thread-1' };
const MAPPING_KEY = { pk: 'USER#user-1', sk: 'THREAD#thread-1' };
const SYSTEM_THREAD_ID = crypto.randomUUID();

const testEnv = {} as {
  lookupThread: typeof lookupThread;
  getMessages: typeof getMessages;
  sliceMessages: typeof sliceMessages;
};

beforeAll(async () => {
  stubDynamoDBDocumentClient();
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  const messagesModule = await import('./messages.ts');
  testEnv.lookupThread = messagesModule.lookupThread;
  testEnv.getMessages = messagesModule.getMessages;
  testEnv.sliceMessages = messagesModule.sliceMessages;
});

afterAll(() => {
  vi.useRealTimers();
});

function storedMapping(expiresAt = NOW_SECONDS + 1) {
  return {
    ...MAPPING_KEY,
    ...KEY,
    systemThreadId: SYSTEM_THREAD_ID,
    expiresAt,
    __edb_e__: 'threadMapping',
    __edb_v__: '1',
  };
}

function storedMessage(
  messageId: string,
  role: string,
  content: string,
  createdAt: string,
) {
  return {
    pk: `THREAD#${SYSTEM_THREAD_ID}`,
    sk: `MESSAGE#${messageId}`,
    systemThreadId: SYSTEM_THREAD_ID,
    messageId,
    role,
    content,
    runId: 'run-1',
    createdAt,
    expiresAt: NOW_SECONDS + 31_536_000,
    __edb_e__: 'message',
    __edb_v__: '1',
  };
}

describe('lookupThread', () => {
  it('returns the system thread id when the mapping exists and has not expired', async () => {
    send.mockResolvedValueOnce({ Item: storedMapping() });

    const result = await testEnv.lookupThread(KEY);

    expect(result).toEqual({ systemThreadId: SYSTEM_THREAD_ID });
  });

  it('returns undefined when no mapping exists', async () => {
    send.mockResolvedValueOnce({});

    const result = await testEnv.lookupThread(KEY);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the mapping has expired', async () => {
    send.mockResolvedValueOnce({ Item: storedMapping(NOW_SECONDS) });

    const result = await testEnv.lookupThread(KEY);

    expect(result).toBeUndefined();
  });
});

describe('getMessages', () => {
  it('returns messages mapped to the StoredMessage shape', async () => {
    send.mockResolvedValueOnce({
      Items: [
        storedMessage('msg-1', 'user', 'Hello', '2026-09-03T12:00:00.000Z'),
        storedMessage(
          'msg-2',
          'assistant',
          'Hi there',
          '2026-09-03T12:00:01.000Z',
        ),
      ],
    });

    const result = await testEnv.getMessages(SYSTEM_THREAD_ID);

    expect(result).toEqual([
      {
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
        createdAt: '2026-09-03T12:00:00.000Z',
      },
      {
        messageId: 'msg-2',
        role: 'assistant',
        content: 'Hi there',
        createdAt: '2026-09-03T12:00:01.000Z',
      },
    ]);
  });

  it('returns an empty array when no messages exist', async () => {
    send.mockResolvedValueOnce({ Items: [] });

    const result = await testEnv.getMessages(SYSTEM_THREAD_ID);

    expect(result).toEqual([]);
  });
});

describe('sliceMessages', () => {
  const messages: StoredMessage[] = [
    {
      messageId: 'c',
      role: 'user',
      content: 'Third',
      createdAt: '2026-09-03T12:00:02.000Z',
    },
    {
      messageId: 'a',
      role: 'user',
      content: 'First',
      createdAt: '2026-09-03T12:00:00.000Z',
    },
    {
      messageId: 'b',
      role: 'assistant',
      content: 'Second',
      createdAt: '2026-09-03T12:00:01.000Z',
    },
  ];

  it('returns all messages sorted by createdAt ascending when within the page size', () => {
    const result = testEnv.sliceMessages(messages);

    expect(result.messages.map((m) => m.messageId)).toEqual(['a', 'b', 'c']);
    expect(result.oldestMessageId).toBeUndefined();
  });

  it('returns messages before the given message id', () => {
    const result = testEnv.sliceMessages(messages, 'c');

    expect(result.messages.map((m) => m.messageId)).toEqual(['a', 'b']);
    expect(result.oldestMessageId).toBeUndefined();
  });

  it('returns empty messages when before references an unknown id', () => {
    const result = testEnv.sliceMessages(messages, 'unknown');

    expect(result.messages).toEqual([]);
    expect(result.oldestMessageId).toBeUndefined();
  });

  it('returns empty messages when before references the earliest message', () => {
    const result = testEnv.sliceMessages(messages, 'a');

    expect(result.messages).toEqual([]);
    expect(result.oldestMessageId).toBeUndefined();
  });

  it('handles an empty messages array', () => {
    const result = testEnv.sliceMessages([]);

    expect(result.messages).toEqual([]);
    expect(result.oldestMessageId).toBeUndefined();
  });
});
