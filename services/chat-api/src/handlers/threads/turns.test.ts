import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import type { ResolvedThread, ThreadKey } from '../../persistence/threads.ts';
import type { StoredTurn, TurnPage } from '../../persistence/turns.ts';
import { TurnCursor } from '../../schemas/turn-cursor.ts';
import { apiGatewayProxyEventFixture } from '../../test-utils/api-gateway.ts';

/* eslint-disable unicorn/no-null -- API Gateway types body as string | null */

type StandardHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
) => Promise<APIGatewayProxyResult>;

const testEnv = {} as { handler: StandardHandler };

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_USER_ID = crypto.randomUUID();
const SYSTEM_THREAD_ID = crypto.randomUUID();
const END_USER_ID_HEADER = { 'end-user-id': VALID_USER_ID };

const lookupThread = vi
  .fn<(key: ThreadKey) => Promise<ResolvedThread | undefined>>()
  .mockResolvedValue({ systemThreadId: SYSTEM_THREAD_ID });
const getTurnPage = vi
  .fn<(systemThreadId: string, from?: TurnCursor) => Promise<TurnPage>>()
  .mockResolvedValue({ turns: [] });

beforeAll(async () => {
  vi.doMock('../../persistence/messages.ts', () => ({ lookupThread }));
  vi.doMock('../../persistence/turns.ts', () => ({ getTurnPage }));
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');

  const turnsModule = await import('./turns.ts');
  testEnv.handler = turnsModule.handler as unknown as StandardHandler;
});

beforeEach(() => {
  lookupThread.mockResolvedValue({ systemThreadId: SYSTEM_THREAD_ID });
  getTurnPage.mockResolvedValue({ turns: [] });
});

function validEvent(
  queryOverrides?: Record<string, string>,
): APIGatewayProxyEvent {
  return apiGatewayProxyEventFixture(null, END_USER_ID_HEADER, {
    pathParameters: { threadId: VALID_THREAD_ID },
    queryStringParameters: queryOverrides,
    httpMethod: 'GET',
  });
}

async function runHandler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return testEnv.handler(event, {} as Context);
}

function parsedBody(response: APIGatewayProxyResult): unknown {
  return JSON.parse(response.body);
}

describe('request headers', () => {
  it('returns 422 when end-user-id header is missing', async () => {
    const event = apiGatewayProxyEventFixture(
      null,
      {},
      {
        pathParameters: { threadId: VALID_THREAD_ID },
        httpMethod: 'GET',
      },
    );

    const response = await runHandler(event);

    expect(response.statusCode).toBe(422);
    expect(parsedBody(response)).toMatchObject({
      error: 'Turns retrieval error',
      details: expect.objectContaining({
        fieldErrors: expect.objectContaining({
          'end-user-id': expect.anything(),
        }),
      }),
    });
    expect(lookupThread).not.toHaveBeenCalled();
  });
});

describe('path parameter validation', () => {
  it('returns 422 when threadId is not a UUID', async () => {
    const event = apiGatewayProxyEventFixture(null, END_USER_ID_HEADER, {
      pathParameters: { threadId: 'not-a-uuid' },
      httpMethod: 'GET',
    });

    const response = await runHandler(event);

    expect(response.statusCode).toBe(422);
    expect(parsedBody(response)).toMatchObject({
      error: 'Turns retrieval error',
      details: expect.objectContaining({
        fieldErrors: expect.objectContaining({
          threadId: expect.anything(),
        }),
      }),
    });
    expect(lookupThread).not.toHaveBeenCalled();
  });
});

describe('query parameter validation', () => {
  it('returns 422 when the cursor is malformed', async () => {
    const event = validEvent({ cursor: 'not-a-cursor' });

    const response = await runHandler(event);

    expect(response.statusCode).toBe(422);
    expect(parsedBody(response)).toMatchObject({
      error: 'Turns retrieval error',
      details: expect.objectContaining({
        fieldErrors: expect.objectContaining({
          cursor: expect.anything(),
        }),
      }),
    });
    expect(getTurnPage).not.toHaveBeenCalled();
  });
});

describe('thread not found', () => {
  it('returns 404 when the thread does not exist', async () => {
    lookupThread.mockResolvedValueOnce(undefined);

    const response = await runHandler(validEvent());

    expect(response.statusCode).toBe(404);
    expect(parsedBody(response)).toEqual({ error: 'Thread not found' });
  });
});

describe('store failure', () => {
  it('returns a 500 JSON error when the store throws', async () => {
    getTurnPage.mockRejectedValueOnce(new Error('DynamoDB error'));

    const response = await runHandler(validEvent());

    expect(response.statusCode).toBe(500);
    expect(parsedBody(response)).toEqual({ error: 'Turns retrieval error' });
  });
});

describe('successful retrieval', () => {
  const USER_TURN: StoredTurn = {
    turnId: 'd0000000-0000-4000-8000-000000000001',
    sender: 'user',
    createdAt: '2026-09-03T12:00:00.000Z',
    messages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
  };
  const ASSISTANT_TURN: StoredTurn = {
    turnId: 'e0000000-0000-4000-8000-000000000001',
    sender: 'assistant',
    createdAt: '2026-09-03T12:00:01.000Z',
    messages: [{ id: 'msg-2', role: 'assistant', content: 'Hi there' }],
  };

  it('returns the turns in order, each with its messages', async () => {
    getTurnPage.mockResolvedValueOnce({ turns: [USER_TURN, ASSISTANT_TURN] });

    const response = await runHandler(validEvent());

    expect(response.statusCode).toBe(200);
    expect(parsedBody(response)).toEqual({
      turns: [
        {
          id: USER_TURN.turnId,
          sender: 'user',
          createdAt: USER_TURN.createdAt,
          messages: USER_TURN.messages,
        },
        {
          id: ASSISTANT_TURN.turnId,
          sender: 'assistant',
          createdAt: ASSISTANT_TURN.createdAt,
          messages: ASSISTANT_TURN.messages,
          feedbackUrl: `/v1/threads/${VALID_THREAD_ID}/turns/${ASSISTANT_TURN.turnId}/feedback`,
        },
      ],
    });
  });

  it('returns the feedback, and no feedbackUrl, for an assistant turn with a reaction', async () => {
    const feedback = {
      reaction: 'positive',
      createdAt: '2026-09-03T12:00:02.000Z',
    } as const;
    getTurnPage.mockResolvedValueOnce({
      turns: [{ ...ASSISTANT_TURN, feedback } as StoredTurn],
    });

    const response = await runHandler(validEvent());

    expect(parsedBody(response)).toEqual({
      turns: [expect.objectContaining({ feedback })],
    });
    expect(parsedBody(response)).not.toHaveProperty('turns.0.feedbackUrl');
  });

  it('resolves the thread using the end-user-id header and path threadId', async () => {
    await runHandler(validEvent());

    expect(lookupThread).toHaveBeenCalledWith({
      endUserId: VALID_USER_ID,
      userThreadId: VALID_THREAD_ID,
    });
  });

  it('reads the page starting from the decoded cursor', async () => {
    const cursor = TurnCursor.before({
      createdAt: '2026-09-03T12:00:00.000Z',
      turnId: crypto.randomUUID(),
    });

    await runHandler(validEvent({ cursor: cursor.toString() }));

    expect(getTurnPage).toHaveBeenCalledWith(SYSTEM_THREAD_ID, cursor);
  });

  it('omits the earlier and later URLs when the page has no cursors', async () => {
    const response = await runHandler(validEvent());

    expect(parsedBody(response)).toEqual({ turns: [] });
  });

  it('builds earlierTurnsUrl and laterTurnsUrl from the page cursors', async () => {
    const earlier = TurnCursor.before({
      createdAt: '2026-09-03T12:00:00.000Z',
      turnId: crypto.randomUUID(),
    });
    const later = TurnCursor.after({
      createdAt: '2026-09-03T12:00:01.000Z',
      turnId: crypto.randomUUID(),
    });
    getTurnPage.mockResolvedValueOnce({ turns: [], earlier, later });

    const response = await runHandler(validEvent());

    expect(parsedBody(response)).toEqual({
      turns: [],
      earlierTurnsUrl: `/v1/threads/${VALID_THREAD_ID}/turns?cursor=${earlier}`,
      laterTurnsUrl: `/v1/threads/${VALID_THREAD_ID}/turns?cursor=${later}`,
    });
  });
});
