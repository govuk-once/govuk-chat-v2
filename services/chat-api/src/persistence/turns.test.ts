import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { send, stubDynamoDBDocumentClient } from '../test-utils/dynamodb.ts';
import { TurnCursor } from '../schemas/turn-cursor.ts';
import type { getTurnPage } from './turns.ts';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const SYSTEM_THREAD_ID = crypto.randomUUID();
const THREAD_PK = `$chat-api#systemthreadid_${SYSTEM_THREAD_ID}`;

const testEnv = {} as { getTurnPage: typeof getTurnPage };

beforeAll(async () => {
  stubDynamoDBDocumentClient();
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  const turnsModule = await import('./turns.ts');
  testEnv.getTurnPage = turnsModule.getTurnPage;
});

afterAll(() => {
  vi.useRealTimers();
});

function storedTurn(
  turnId: string,
  sender: 'user' | 'assistant',
  createdAt: string,
) {
  const entity = sender === 'user' ? 'userTurn' : 'assistantTurn';
  return {
    pk: THREAD_PK,
    sk: `$${entity.toLowerCase()}_1#turnid_${turnId}`,
    gsi1pk: THREAD_PK,
    gsi1sk: `$threadturns#createdat_${createdAt.toLowerCase()}#turnid_${turnId}#${entity.toLowerCase()}_1`,
    systemThreadId: SYSTEM_THREAD_ID,
    turnId,
    sender,
    runId: 'run-1',
    messages: [{ id: `message-${turnId}`, role: sender, content: turnId }],
    createdAt,
    ...(sender === 'assistant' && { firstOutputAt: createdAt }),
    expiresAt: NOW_SECONDS + 31_536_000,
    __edb_e__: entity,
    __edb_v__: '1',
  };
}

// A user turn then an assistant turn per run, oldest first, a second apart
function threadOf(count: number) {
  return Array.from({ length: count }, (_, index) =>
    storedTurn(
      `turn-${String(index).padStart(3, '0')}`,
      index % 2 === 0 ? 'user' : 'assistant',
      new Date(NOW.getTime() + index * 1000).toISOString(),
    ),
  );
}

function lastEvaluatedKey(turn: ReturnType<typeof storedTurn>) {
  const { pk, sk, gsi1pk, gsi1sk } = turn;
  return { pk, sk, gsi1pk, gsi1sk };
}

interface QueryInput {
  IndexName?: string;
  KeyConditionExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
  ScanIndexForward?: boolean;
  Limit?: number;
  ExclusiveStartKey?: Record<string, string>;
}

function sentQueryInput(call = 0): QueryInput {
  return (send.mock.calls[call][0] as { input: QueryInput }).input;
}

function sortKeyValues(): unknown[] {
  const input = sentQueryInput();
  return input.KeyConditionExpression.matchAll(/:sk\d/g)
    .map(([placeholder]) => input.ExpressionAttributeValues[placeholder])
    .toArray();
}

function turnIds(turns: { turnId: string }[]): string[] {
  return turns.map(({ turnId }) => turnId);
}

describe('getTurnPage', () => {
  describe('without a start', () => {
    it('queries the collection for the newest turns, descending, reading one more than a page', async () => {
      send.mockResolvedValueOnce({ Items: [] });

      await testEnv.getTurnPage(SYSTEM_THREAD_ID);

      expect(sentQueryInput()).toMatchObject({
        IndexName: 'gsi1',
        ScanIndexForward: false,
        Limit: 101,
      });
      expect(sortKeyValues()).toEqual(['$threadturns']);
    });

    it('returns the turns oldest first, with no positions, when fewer than 101 come back', async () => {
      const thread = threadOf(3);
      send.mockResolvedValueOnce({ Items: thread.toReversed() });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID);

      expect(result).toEqual({
        turns: thread.map(({ turnId, sender, createdAt, messages }) => ({
          turnId,
          sender,
          createdAt,
          messages,
        })),
      });
    });

    it('drops the oldest read and returns an earlier position, but no later one, when 101 come back', async () => {
      const thread = threadOf(101);
      send.mockResolvedValueOnce({ Items: thread.toReversed() });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID);

      expect(turnIds(result.turns)).toEqual(turnIds(thread.slice(1)));
      expect(result.earlier).toEqual(TurnCursor.before(thread[1]));
      expect(result.later).toBeUndefined();
    });

    it('queries again from where a short response stopped, so the page stays full', async () => {
      const thread = threadOf(101).toReversed();
      send
        .mockResolvedValueOnce({
          Items: thread.slice(0, 50),
          LastEvaluatedKey: lastEvaluatedKey(thread[49]),
        })
        .mockResolvedValueOnce({ Items: thread.slice(50) });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID);

      expect(send).toHaveBeenCalledTimes(2);
      expect(sentQueryInput(1).ExclusiveStartKey).toEqual(
        lastEvaluatedKey(thread[49]),
      );
      expect(result.turns).toHaveLength(100);
      expect(result.earlier).toEqual(TurnCursor.before(thread[99]));
    });

    it('merges the turns in createdAt order, then turn id', async () => {
      const createdAt = NOW.toISOString();
      const sameTime = [
        storedTurn('turn-b', 'assistant', createdAt),
        storedTurn('turn-a', 'user', createdAt),
      ];
      const earlier = storedTurn(
        'turn-z',
        'assistant',
        new Date(NOW.getTime() - 1000).toISOString(),
      );
      send.mockResolvedValueOnce({ Items: [...sameTime, earlier] });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID);

      expect(turnIds(result.turns)).toEqual(['turn-z', 'turn-a', 'turn-b']);
    });
  });

  describe('with a before start', () => {
    const start = TurnCursor.before(threadOf(102)[101]);

    it('queries the collection from its first turn up to the start, descending, reading one more than a page', async () => {
      send.mockResolvedValueOnce({ Items: [] });

      await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(sentQueryInput()).toMatchObject({
        IndexName: 'gsi1',
        ScanIndexForward: false,
        Limit: 101,
      });
      const [lower, upper] = sortKeyValues();
      expect(lower).toBe('$threadturns#createdat_');
      expect(upper).toContain(start.turnId);
    });

    it('returns the turns oldest first, with only a later position, when fewer than 101 come back', async () => {
      const thread = threadOf(3);
      send.mockResolvedValueOnce({ Items: thread.toReversed() });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(turnIds(result.turns)).toEqual(turnIds(thread));
      expect(result.earlier).toBeUndefined();
      expect(result.later).toEqual(TurnCursor.after(thread[2]));
    });

    it('drops the oldest read and returns both positions when 101 come back', async () => {
      const thread = threadOf(101);
      send.mockResolvedValueOnce({ Items: thread.toReversed() });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(turnIds(result.turns)).toEqual(turnIds(thread.slice(1)));
      expect(result.earlier).toEqual(TurnCursor.before(thread[1]));
      expect(result.later).toEqual(TurnCursor.after(thread[100]));
    });
  });

  describe('with an after start', () => {
    const thread = threadOf(102);
    const start = TurnCursor.after(thread[0]);

    it('queries the collection above the start, ascending, reading one more than a page', async () => {
      send.mockResolvedValueOnce({ Items: [] });

      await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(sentQueryInput()).toMatchObject({
        IndexName: 'gsi1',
        ScanIndexForward: true,
        Limit: 101,
      });
      expect(sortKeyValues()).toEqual([expect.stringContaining(start.turnId)]);
    });

    it('leaves out the turn at the start, which the query reads too', async () => {
      send.mockResolvedValueOnce({ Items: thread.slice(0, 4) });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(turnIds(result.turns)).toEqual(turnIds(thread.slice(1, 4)));
      expect(result.earlier).toEqual(TurnCursor.before(thread[1]));
      expect(result.later).toBeUndefined();
    });

    it('drops the newest read and returns both positions when 101 come back after the start', async () => {
      send.mockResolvedValueOnce({ Items: thread });

      const result = await testEnv.getTurnPage(SYSTEM_THREAD_ID, start);

      expect(turnIds(result.turns)).toEqual(turnIds(thread.slice(1, 101)));
      expect(result.earlier).toEqual(TurnCursor.before(thread[1]));
      expect(result.later).toEqual(TurnCursor.after(thread[100]));
    });
  });

  it.each(['before', 'after'] as const)(
    'returns no positions for an empty page with a %s start',
    async (direction) => {
      send.mockResolvedValueOnce({ Items: [] });

      const result = await testEnv.getTurnPage(
        SYSTEM_THREAD_ID,
        TurnCursor[direction](threadOf(1)[0]),
      );

      expect(result).toEqual({ turns: [] });
    },
  );
});
