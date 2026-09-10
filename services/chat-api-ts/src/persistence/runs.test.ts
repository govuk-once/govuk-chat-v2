import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { send, stubDynamoDBDocumentClient } from '../test-utils/dynamodb.ts';
import type { beginRun, finishRun, releaseRun } from './runs.ts';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const LEASE_SECONDS = 30;
const A_YEAR_AHEAD = NOW_SECONDS + 31_536_000;

const KEY = {
  systemThreadId: 'thread-1',
  runId: 'run-1',
  messageId: 'message-1',
};
const THREAD_PK = 'THREAD#thread-1';

const testEnv = {} as {
  beginRun: typeof beginRun;
  finishRun: typeof finishRun;
  releaseRun: typeof releaseRun;
};

beforeAll(async () => {
  stubDynamoDBDocumentClient();
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');
  vi.stubEnv('RUN_LOCK_LEASE_SECONDS', String(LEASE_SECONDS));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  const runsModule = await import('./runs.ts');
  testEnv.beginRun = runsModule.beginRun;
  testEnv.finishRun = runsModule.finishRun;
  testEnv.releaseRun = runsModule.releaseRun;
});

afterAll(() => {
  vi.useRealTimers();
});

function transactionCancelled(codes: string[]): Error {
  return Object.assign(new Error('Transaction cancelled'), {
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

interface WriteItem {
  Key?: Record<string, string>;
  Item?: Record<string, unknown>;
  ConditionExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
}

type TransactItem = {
  Put?: WriteItem;
  Delete?: WriteItem;
  ConditionCheck?: WriteItem;
};

function transactItems(): TransactItem[] {
  const input = send.mock.calls[0][0] as {
    input: { TransactItems?: TransactItem[] };
  };
  return input.input.TransactItems ?? expect.fail('Expected a transaction');
}

function sentCommandInput(): { Key?: Record<string, string> } & WriteItem {
  const [call] = send.mock.calls;
  return (call[0] as { input: WriteItem & { Key?: Record<string, string> } })
    .input;
}

describe('configuration', () => {
  it('throws an error during module import when RUN_LOCK_LEASE_SECONDS is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');
    vi.stubEnv('RUN_LOCK_LEASE_SECONDS', undefined);

    await expect(import('./runs.ts')).rejects.toThrow(
      'RUN_LOCK_LEASE_SECONDS is not configured',
    );
  });
});

describe('beginRun', () => {
  it('claims the lock and checks the run and message ids in one transaction', async () => {
    send.mockResolvedValueOnce({});

    await expect(testEnv.beginRun(KEY)).resolves.toEqual({
      status: 'claimed',
    });

    const [lock, run, message] = transactItems();
    expect(lock.Put?.Item).toMatchObject({
      pk: THREAD_PK,
      sk: 'LOCK',
      runId: KEY.runId,
      expiresAt: NOW_SECONDS + LEASE_SECONDS,
    });
    expect(run.ConditionCheck?.Key).toEqual({ pk: THREAD_PK, sk: 'RUN#run-1' });
    expect(message.ConditionCheck?.Key).toEqual({
      pk: THREAD_PK,
      sk: 'MESSAGE#message-1',
    });

    for (const item of [lock.Put, run.ConditionCheck, message.ConditionCheck]) {
      expect(item?.ConditionExpression).toMatch(
        /attribute_not_exists\(.+\) OR .+ <= /,
      );
      expect(Object.values(item?.ExpressionAttributeValues ?? {})).toContain(
        NOW_SECONDS,
      );
    }
  });

  it.each([
    ['thread-busy', ['ConditionalCheckFailed', 'None', 'None']],
    ['thread-busy', ['None', 'None', 'TransactionConflict']],
    ['duplicate-run', ['None', 'ConditionalCheckFailed', 'None']],
    ['duplicate-message', ['None', 'None', 'ConditionalCheckFailed']],
  ])(
    'reports %s when the claim is cancelled with %j',
    async (status, codes) => {
      send.mockRejectedValueOnce(transactionCancelled(codes));

      await expect(testEnv.beginRun(KEY)).resolves.toEqual({ status });
    },
  );

  it('throws when the claim is cancelled for a reason that is not a conflict', async () => {
    send.mockRejectedValueOnce(
      transactionCancelled(['ThrottlingError', 'None', 'None']),
    );

    await expect(testEnv.beginRun(KEY)).rejects.toThrow(
      'Run claim was cancelled: ThrottlingError, None, None',
    );
  });
});

describe('finishRun', () => {
  const ASSISTANT_MESSAGES = [
    {
      messageId: 'message-2',
      role: 'assistant',
      content: 'Hi there',
      createdAt: '2026-09-08T12:00:01.000Z',
    },
  ];

  it('records the run, assistant messages and releases the lock in one transaction', async () => {
    send.mockResolvedValueOnce({});

    await testEnv.finishRun(KEY, ASSISTANT_MESSAGES);

    const [run, assistantMessage, lock] = transactItems();
    expect(run.Put?.Item).toMatchObject({
      pk: THREAD_PK,
      sk: 'RUN#run-1',
      expiresAt: A_YEAR_AHEAD,
    });
    expect(assistantMessage.Put?.Item).toMatchObject({
      pk: THREAD_PK,
      sk: 'MESSAGE#message-2',
      role: 'assistant',
      content: 'Hi there',
      runId: KEY.runId,
      expiresAt: A_YEAR_AHEAD,
    });
    expect(lock.Delete?.Key).toEqual({ pk: THREAD_PK, sk: 'LOCK' });
    expect(
      Object.values(lock.Delete?.ExpressionAttributeValues ?? {}),
    ).toContain(KEY.runId);
  });

  it('throws when the completion is cancelled', async () => {
    send.mockRejectedValueOnce(
      transactionCancelled(['None', 'None', 'ConditionalCheckFailed']),
    );

    await expect(testEnv.finishRun(KEY, ASSISTANT_MESSAGES)).rejects.toThrow(
      'Run completion was cancelled',
    );
  });
});

describe('releaseRun', () => {
  it('deletes the lock only while this run still holds it', async () => {
    send.mockResolvedValueOnce({});

    await testEnv.releaseRun(KEY);

    const input = sentCommandInput();
    expect(input.Key).toEqual({ pk: THREAD_PK, sk: 'LOCK' });
    expect(Object.values(input.ExpressionAttributeValues)).toContain(KEY.runId);
  });
});
