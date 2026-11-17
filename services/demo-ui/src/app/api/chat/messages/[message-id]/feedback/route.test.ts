import { NextRequest, type NextResponse } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiveFeedbackInput } from '../../../../../../chat-api/client.ts';
import { endUserIdFor } from '../../../../../../chat-api/end-user-id.ts';

const THREAD_ID = crypto.randomUUID();
const MESSAGE_ID = crypto.randomUUID();
const USER_SUB = crypto.randomUUID();

const readSession = vi.fn<() => Promise<{ sub: string } | undefined>>();
const giveFeedback = vi.fn<(input: GiveFeedbackInput) => Promise<Response>>();

const testEnv = {} as {
  POST: (
    request: NextRequest,
    context: { params: Promise<{ 'message-id': string }> },
  ) => Promise<NextResponse>;
};

beforeAll(async () => {
  vi.doMock('../../../../../../auth/session.ts', () => ({ readSession }));
  vi.doMock('../../../../../../chat-api/client.ts', () => ({ giveFeedback }));
  const routeModule = await import('./route.ts');
  testEnv.POST = routeModule.POST;
});

beforeEach(() => {
  readSession.mockResolvedValue({ sub: USER_SUB });
  giveFeedback.mockResolvedValue(Response.json({}, { status: 201 }));
});

function feedbackRequest(
  body: unknown,
  cookie = `thread_id=${THREAD_ID}`,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/chat/messages/${MESSAGE_ID}/feedback`,
    {
      method: 'POST',
      headers: { cookie },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

function postFeedback(
  request: NextRequest,
  messageId = MESSAGE_ID,
): Promise<NextResponse> {
  return testEnv.POST(request, {
    params: Promise.resolve({ 'message-id': messageId }),
  });
}

describe('POST', () => {
  it('gives the feedback on the message in the thread as the signed-in user', async () => {
    const request = feedbackRequest({ reaction: 'negative' });

    const response = await postFeedback(request);

    expect(giveFeedback).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      messageId: MESSAGE_ID,
      endUserId: endUserIdFor(USER_SUB),
      reaction: 'negative',
      signal: request.signal,
    });
    expect(response.status).toBe(201);
  });

  it('returns 401 when the session is invalid', async () => {
    readSession.mockResolvedValue(undefined);

    const response = await postFeedback(
      feedbackRequest({ reaction: 'positive' }),
    );

    expect(response.status).toBe(401);
    expect(giveFeedback).not.toHaveBeenCalled();
  });

  it('returns 404 when there is no thread cookie', async () => {
    const response = await postFeedback(
      feedbackRequest({ reaction: 'positive' }, ''),
    );

    expect(response.status).toBe(404);
    expect(giveFeedback).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the message id is not a UUID',
      feedbackRequest({ reaction: 'positive' }),
      'not-a-uuid',
    ],
    ['the body is not JSON', feedbackRequest('not json'), MESSAGE_ID],
    [
      'the reaction is not recognised',
      feedbackRequest({ reaction: 'meh' }),
      MESSAGE_ID,
    ],
  ])('returns 422 when %s', async (_case, request, messageId) => {
    const response = await postFeedback(request, messageId);

    expect(response.status).toBe(422);
    expect(giveFeedback).not.toHaveBeenCalled();
  });

  it('returns the API status with a generic error when the API rejects the feedback', async () => {
    giveFeedback.mockResolvedValueOnce(
      Response.json({ error: 'Feedback already provided' }, { status: 409 }),
    );

    const response = await postFeedback(
      feedbackRequest({ reaction: 'positive' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Chat API request failed' });
  });
});
