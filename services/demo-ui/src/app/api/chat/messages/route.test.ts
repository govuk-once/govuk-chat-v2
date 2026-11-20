import { NextRequest, type NextResponse } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadInput } from '../../../../chat-api/client.ts';
import { endUserIdFor } from '../../../../chat-api/end-user-id.ts';

const THREAD_ID = crypto.randomUUID();
const USER_SUB = crypto.randomUUID();
const USER_MESSAGE = {
  id: crypto.randomUUID(),
  role: 'user',
  content: 'Tell me about SSP',
};
const ASSISTANT_MESSAGES = [
  { id: crypto.randomUUID(), role: 'assistant', content: 'SSP is...' },
  { id: crypto.randomUUID(), role: 'assistant', content: 'It lasts...' },
];
const TURNS = [
  { id: crypto.randomUUID(), sender: 'user', messages: [USER_MESSAGE] },
  {
    id: crypto.randomUUID(),
    sender: 'assistant',
    messages: ASSISTANT_MESSAGES,
  },
];

const readSession = vi.fn<() => Promise<{ sub: string } | undefined>>();
const listThreadTurns = vi.fn<(input: ThreadInput) => Promise<Response>>();

const testEnv = {} as {
  GET: (request: NextRequest) => Promise<NextResponse>;
};

beforeAll(async () => {
  vi.doMock('../../../../auth/session.ts', () => ({ readSession }));
  vi.doMock('../../../../chat-api/client.ts', () => ({ listThreadTurns }));
  const routeModule = await import('./route.ts');
  testEnv.GET = routeModule.GET;
});

beforeEach(() => {
  readSession.mockResolvedValue({ sub: USER_SUB });
});

function messagesRequest(cookie = `thread_id=${THREAD_ID}`): NextRequest {
  return new NextRequest('http://localhost/api/chat/messages', {
    headers: { cookie },
  });
}

describe('GET', () => {
  it("returns each turn's messages using the signed-in user sub and renews the thread cookie", async () => {
    listThreadTurns.mockResolvedValueOnce(
      Response.json({
        turns: TURNS,
        earlierTurnsUrl: `/v1/threads/${THREAD_ID}/turns?cursor=x`,
      }),
    );
    const request = messagesRequest();

    const response = await testEnv.GET(request);

    expect(listThreadTurns).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      endUserId: endUserIdFor(USER_SUB),
      signal: request.signal,
    });
    expect(await response.json()).toEqual({
      messages: [USER_MESSAGE, ...ASSISTANT_MESSAGES],
    });
    expect(response.cookies.get('thread_id')?.value).toBe(THREAD_ID);
  });

  it('returns no messages when there is no thread cookie', async () => {
    const response = await testEnv.GET(messagesRequest(''));

    expect(await response.json()).toEqual({ messages: [] });
    expect(listThreadTurns).not.toHaveBeenCalled();
  });

  it('returns 401 when the session is invalid', async () => {
    readSession.mockResolvedValue(undefined);

    const response = await testEnv.GET(messagesRequest());

    expect(response.status).toBe(401);
    expect(listThreadTurns).not.toHaveBeenCalled();
  });

  it('returns no messages when the API does not find the thread', async () => {
    listThreadTurns.mockResolvedValueOnce(
      Response.json({ error: 'Thread not found' }, { status: 404 }),
    );

    const response = await testEnv.GET(messagesRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });

  it('returns the API status with a generic error when the API fails', async () => {
    listThreadTurns.mockResolvedValueOnce(
      Response.json({ error: 'Turns retrieval error' }, { status: 500 }),
    );

    const response = await testEnv.GET(messagesRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Chat API request failed' });
  });
});
