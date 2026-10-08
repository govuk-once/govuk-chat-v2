import { NextRequest, type NextResponse } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeThreadInput } from '../../../chat-api/client.ts';

const THREAD_ID = crypto.randomUUID();
const USER_SUB = crypto.randomUUID();
const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
const SSE_EVENTS = [
  'data: {"type":"RUN_STARTED"}\n\n',
  'data: {"type":"RUN_FINISHED"}\n\n',
];

const signedInSub = vi.fn<(headers: Headers) => Promise<string | undefined>>();
const invokeThread = vi.fn<(input: InvokeThreadInput) => Promise<Response>>();

const testEnv = {} as {
  POST: (request: NextRequest) => Promise<NextResponse>;
};

beforeAll(async () => {
  vi.doMock('../../../auth/auth.ts', () => ({ signedInSub }));
  vi.doMock('../../../chat-api/client.ts', () => ({ invokeThread }));
  const routeModule = await import('./route.ts');
  testEnv.POST = routeModule.POST;
});

beforeEach(() => {
  signedInSub.mockResolvedValue(USER_SUB);
  invokeThread.mockResolvedValue(new Response(sseStream()));
});

function sseStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of SSE_EVENTS) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

function runAgentInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    threadId: THREAD_ID,
    runId: 'assistant-ui-run-id',
    messages: [
      { id: 'message-1', role: 'user', content: 'Tell me about SSP' },
      { id: 'message-2', role: 'assistant', content: 'SSP is...' },
      { id: 'message-3', role: 'user', content: 'Who pays it?' },
    ],
    tools: [],
    context: [],
    forwardedProps: { source: 'assistant-ui' },
    ...overrides,
  };
}

function chatRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { cookie: 'session=valid-session' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST', () => {
  it('invokes the thread with the signed-in user sub and a fresh run id', async () => {
    const request = chatRequest(runAgentInput());

    await testEnv.POST(request);

    expect(invokeThread).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      runId: expect.stringMatching(UUID_PATTERN),
      endUserId: USER_SUB,
      content: 'Who pays it?',
      signal: request.signal,
    });
  });

  it('relays a successful response stream unchanged as an event stream', async () => {
    const response = await testEnv.POST(chatRequest(runAgentInput()));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe(SSE_EVENTS.join(''));
  });

  it('keeps the thread in a cookie', async () => {
    const response = await testEnv.POST(chatRequest(runAgentInput()));

    expect(response.cookies.get('thread_id')?.value).toBe(THREAD_ID);
  });

  it('returns 401 when the session is invalid', async () => {
    signedInSub.mockResolvedValue(undefined);

    const response = await testEnv.POST(chatRequest(runAgentInput()));

    expect(response.status).toBe(401);
    expect(invokeThread).not.toHaveBeenCalled();
  });

  it('returns the API status with a generic error and sets no cookies when the API rejects the request', async () => {
    invokeThread.mockResolvedValueOnce(
      Response.json({ error: 'Thread is busy' }, { status: 409 }),
    );

    const response = await testEnv.POST(chatRequest(runAgentInput()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Chat API request failed' });
    expect(response.cookies.getAll()).toEqual([]);
  });

  it.each([
    ['the body is not JSON', chatRequest('not json')],
    [
      'the body is not a RunAgentInput',
      chatRequest({ threadId: THREAD_ID, messages: [] }),
    ],
    [
      'the thread id is not a UUID',
      chatRequest(runAgentInput({ threadId: 'not-a-uuid' })),
    ],
    [
      'the last message is not a user message',
      chatRequest(
        runAgentInput({
          messages: [{ id: 'message-1', role: 'assistant', content: 'Hello' }],
        }),
      ),
    ],
    [
      'the last message has no text',
      chatRequest(
        runAgentInput({
          messages: [{ id: 'message-1', role: 'user', content: '' }],
        }),
      ),
    ],
    [
      'the last message content is not a string',
      chatRequest(
        runAgentInput({
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: [{ type: 'text', text: 'Hello' }],
            },
          ],
        }),
      ),
    ],
  ])('returns 422 when %s', async (_case, request) => {
    const response = await testEnv.POST(request);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(invokeThread).not.toHaveBeenCalled();
  });
});
