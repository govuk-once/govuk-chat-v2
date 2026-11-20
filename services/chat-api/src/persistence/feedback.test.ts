import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { send, stubDynamoDBDocumentClient } from '../test-utils/dynamodb.ts';
import type { recordFeedback, recordTurnFeedback } from './feedback.ts';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const A_YEAR_AHEAD = NOW_SECONDS + 31_536_000;

const KEY = { systemThreadId: 'thread-1', messageId: 'message-1' };
const THREAD_PK = 'THREAD#thread-1';

const testEnv = {} as {
  recordFeedback: typeof recordFeedback;
  recordTurnFeedback: typeof recordTurnFeedback;
};

beforeAll(async () => {
  stubDynamoDBDocumentClient();
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  const feedbackModule = await import('./feedback.ts');
  testEnv.recordFeedback = feedbackModule.recordFeedback;
  testEnv.recordTurnFeedback = feedbackModule.recordTurnFeedback;
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
  ConditionCheck?: WriteItem;
};

function transactItems(): TransactItem[] {
  const input = send.mock.calls[0][0] as {
    input: { TransactItems?: TransactItem[] };
  };
  return input.input.TransactItems ?? expect.fail('Expected a transaction');
}

describe('recordFeedback', () => {
  it('checks the message is an unexpired assistant message and creates the reaction in one transaction', async () => {
    send.mockResolvedValueOnce({});

    await expect(testEnv.recordFeedback(KEY, 'positive')).resolves.toEqual({
      status: 'recorded',
    });

    const [message, feedback] = transactItems();
    expect(message.ConditionCheck?.Key).toEqual({
      pk: THREAD_PK,
      sk: 'MESSAGE#message-1',
    });
    expect(message.ConditionCheck?.ConditionExpression).toMatch(
      /.+ > .+ AND .+ = /,
    );
    expect(
      Object.values(message.ConditionCheck?.ExpressionAttributeValues ?? {}),
    ).toEqual(expect.arrayContaining([NOW_SECONDS, 'assistant']));

    expect(feedback.Put?.Item).toMatchObject({
      pk: '$chat-api#systemthreadid_thread-1',
      sk: '$feedback_1#messageid_message-1',
      reaction: 'positive',
      createdAt: NOW.toISOString(),
      expiresAt: A_YEAR_AHEAD,
    });
    expect(feedback.Put?.ConditionExpression).toMatch(
      /attribute_not_exists\(.+\) AND attribute_not_exists\(.+\)/,
    );
  });

  it.each([
    ['message-not-found', ['ConditionalCheckFailed', 'None']],
    ['already-provided', ['None', 'ConditionalCheckFailed']],
    ['already-provided', ['None', 'TransactionConflict']],
    ['already-provided', ['TransactionConflict', 'None']],
  ])(
    'reports %s when the transaction is cancelled with %j',
    async (status, codes) => {
      send.mockRejectedValueOnce(transactionCancelled(codes));

      await expect(testEnv.recordFeedback(KEY, 'negative')).resolves.toEqual({
        status,
      });
    },
  );

  it('throws when the transaction is cancelled for an unexpected reason', async () => {
    send.mockRejectedValueOnce(
      transactionCancelled(['ThrottlingError', 'None']),
    );

    await expect(testEnv.recordFeedback(KEY, 'positive')).rejects.toThrow(
      'Feedback recording was cancelled: ThrottlingError, None',
    );
  });
});

describe('recordTurnFeedback', () => {
  const TURN_KEY = { systemThreadId: 'thread-1', turnId: 'turn-1' };
  const ENTITY_PK = '$chat-api#systemthreadid_thread-1';

  it('checks the assistant turn exists unexpired and creates the reaction under its id in one transaction', async () => {
    send.mockResolvedValueOnce({});

    await expect(
      testEnv.recordTurnFeedback(TURN_KEY, 'positive'),
    ).resolves.toEqual({ status: 'recorded' });

    const [turn, feedback] = transactItems();
    expect(turn.ConditionCheck?.Key).toEqual({
      pk: ENTITY_PK,
      sk: '$assistantturn_1#turnid_turn-1',
    });
    expect(turn.ConditionCheck?.ConditionExpression).toMatch(/.+ > .+/);
    expect(
      Object.values(turn.ConditionCheck?.ExpressionAttributeValues ?? {}),
    ).toEqual([NOW_SECONDS]);

    expect(feedback.Put?.Item).toMatchObject({
      pk: ENTITY_PK,
      sk: '$feedback_2#turnid_turn-1',
      reaction: 'positive',
      createdAt: NOW.toISOString(),
      expiresAt: A_YEAR_AHEAD,
    });
    expect(feedback.Put?.ConditionExpression).toMatch(
      /attribute_not_exists\(.+\) AND attribute_not_exists\(.+\)/,
    );
  });

  it.each([
    ['turn-not-found', ['ConditionalCheckFailed', 'None']],
    ['already-provided', ['None', 'ConditionalCheckFailed']],
    ['already-provided', ['None', 'TransactionConflict']],
  ])(
    'reports %s when the transaction is cancelled with %j',
    async (status, codes) => {
      send.mockRejectedValueOnce(transactionCancelled(codes));

      await expect(
        testEnv.recordTurnFeedback(TURN_KEY, 'negative'),
      ).resolves.toEqual({ status });
    },
  );

  it('throws when the transaction is cancelled for an unexpected reason', async () => {
    send.mockRejectedValueOnce(
      transactionCancelled(['ThrottlingError', 'None']),
    );

    await expect(
      testEnv.recordTurnFeedback(TURN_KEY, 'positive'),
    ).rejects.toThrow('Feedback recording was cancelled');
  });
});
