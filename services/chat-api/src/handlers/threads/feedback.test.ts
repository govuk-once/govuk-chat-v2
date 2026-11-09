import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import type { ResolvedThread, ThreadKey } from '../../persistence/threads.ts';
import type {
  FeedbackKey,
  FeedbackOutcome,
  Reaction,
} from '../../persistence/feedback.ts';
import { apiGatewayProxyEventFixture } from '../../test-utils/api-gateway.ts';

type StandardHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
) => Promise<APIGatewayProxyResult>;

const testEnv = {} as { handler: StandardHandler };

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_MESSAGE_ID = crypto.randomUUID();
const VALID_USER_ID = crypto.randomUUID();
const SYSTEM_THREAD_ID = crypto.randomUUID();
const END_USER_ID_HEADER = { 'end-user-id': VALID_USER_ID };
const VALID_PATH_PARAMETERS = {
  threadId: VALID_THREAD_ID,
  messageId: VALID_MESSAGE_ID,
};
const VALID_BODY = JSON.stringify({ reaction: 'positive' });

const lookupThread = vi
  .fn<(key: ThreadKey) => Promise<ResolvedThread | undefined>>()
  .mockResolvedValue({ systemThreadId: SYSTEM_THREAD_ID });
const recordFeedback = vi
  .fn<(key: FeedbackKey, reaction: Reaction) => Promise<FeedbackOutcome>>()
  .mockResolvedValue({ status: 'recorded' });

beforeAll(async () => {
  vi.doMock('../../persistence/messages.ts', () => ({ lookupThread }));
  vi.doMock('../../persistence/feedback.ts', () => ({ recordFeedback }));
  vi.stubEnv('CHAT_API_TABLE_NAME', 'test-chat-api');

  const feedbackModule = await import('./feedback.ts');
  testEnv.handler = feedbackModule.handler as unknown as StandardHandler;
});

beforeEach(() => {
  lookupThread.mockResolvedValue({ systemThreadId: SYSTEM_THREAD_ID });
  recordFeedback.mockResolvedValue({ status: 'recorded' });
});

function feedbackEvent({
  body = VALID_BODY,
  headers = END_USER_ID_HEADER,
  pathParameters = VALID_PATH_PARAMETERS,
}: {
  body?: string;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string>;
} = {}): APIGatewayProxyEvent {
  return apiGatewayProxyEventFixture(body, headers, { pathParameters });
}

async function runHandler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return testEnv.handler(event, {} as Context);
}

function parsedBody(response: APIGatewayProxyResult): unknown {
  return JSON.parse(response.body);
}

describe('request validation', () => {
  it.each([
    ['the end-user-id header is missing', { headers: {} }, 'end-user-id'],
    [
      'threadId is not a UUID',
      {
        pathParameters: { ...VALID_PATH_PARAMETERS, threadId: 'not-a-uuid' },
      },
      'threadId',
    ],
    [
      'messageId is not a UUID',
      {
        pathParameters: { ...VALID_PATH_PARAMETERS, messageId: 'not-a-uuid' },
      },
      'messageId',
    ],
    [
      'the reaction is unrecognised',
      { body: JSON.stringify({ reaction: 'neutral' }) },
      'reaction',
    ],
  ])(
    'returns 422 without recording feedback when %s',
    async (_case, overrides, field) => {
      const response = await runHandler(feedbackEvent(overrides));

      expect(response.statusCode).toBe(422);
      expect(parsedBody(response)).toMatchObject({
        error: 'Feedback recording error',
        details: expect.objectContaining({
          fieldErrors: expect.objectContaining({ [field]: expect.anything() }),
        }),
      });
      expect(recordFeedback).not.toHaveBeenCalled();
    },
  );
});

describe('thread not found', () => {
  it('returns 404 without recording feedback when the thread does not exist', async () => {
    lookupThread.mockResolvedValueOnce(undefined);

    const response = await runHandler(feedbackEvent());

    expect(response.statusCode).toBe(404);
    expect(parsedBody(response)).toEqual({ error: 'Thread not found' });
    expect(recordFeedback).not.toHaveBeenCalled();
  });
});

describe('store failure', () => {
  it.each([
    ['the thread lookup', () => lookupThread],
    ['recording the feedback', () => recordFeedback],
  ])('returns a 500 JSON error when %s throws', async (_, storeCall) => {
    storeCall().mockRejectedValueOnce(new Error('DynamoDB error'));

    const response = await runHandler(feedbackEvent());

    expect(response.statusCode).toBe(500);
    expect(parsedBody(response)).toEqual({
      error: 'Feedback recording error',
    });
  });
});

describe('feedback rejected', () => {
  it.each([
    ['message-not-found', 404],
    ['already-provided', 409],
  ] as const)(
    'returns the status for a %s outcome',
    async (status, statusCode) => {
      recordFeedback.mockResolvedValueOnce({ status });

      const response = await runHandler(feedbackEvent());

      expect(response.statusCode).toBe(statusCode);
      expect(parsedBody(response)).toEqual({ error: expect.any(String) });
    },
  );
});

describe('feedback recorded', () => {
  it('returns 201 with an empty object', async () => {
    const response = await runHandler(feedbackEvent());

    expect(response.statusCode).toBe(201);
    expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(parsedBody(response)).toEqual({});
  });

  it('records the reaction against the message in the end user’s thread', async () => {
    await runHandler(
      feedbackEvent({ body: JSON.stringify({ reaction: 'negative' }) }),
    );

    expect(lookupThread).toHaveBeenCalledWith({
      endUserId: VALID_USER_ID,
      userThreadId: VALID_THREAD_ID,
    });
    expect(recordFeedback).toHaveBeenCalledWith(
      { systemThreadId: SYSTEM_THREAD_ID, messageId: VALID_MESSAGE_ID },
      'negative',
    );
  });
});
