import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import {
  EventType,
  type BaseEvent,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';

const send = vi.fn();
const encoder = new EventEncoder();

vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: vi.fn().mockImplementation(function () {
    return { send };
  }),
  InvokeAgentRuntimeCommand: vi.fn().mockImplementation(function (
    input: unknown,
  ) {
    return { input };
  }),
}));

function createResponseStream() {
  return {
    write: vi.fn(),
    end: vi.fn(),
  };
}

function writtenText(stream: ReturnType<typeof createResponseStream>): string {
  return stream.write.mock.calls
    .map(([chunk]) =>
      Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
    )
    .join('');
}

function aguiEventStream(events: BaseEvent[]) {
  return asyncChunks(events.map((event) => encoder.encode(event)));
}

async function* asyncChunks(chunks: string[]) {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

type HandlerFunction = (
  event: APIGatewayProxyEvent,
  responseStream: ReturnType<typeof createResponseStream>,
  context?: unknown,
) => Promise<void>;

const testEnv = {} as { handler: HandlerFunction };

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_RUN_ID = crypto.randomUUID();
const VALID_USER_ID = 'user-abc-123';
const DEFAULT_HEADERS = { 'end-user-id': VALID_USER_ID };
const AGENT_RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:eu-west-1:123456789012:runtime/test';
const VALID_MESSAGES = [
  { id: 'msg-1', role: 'user', content: 'Tell me about SSP' },
];

beforeAll(async () => {
  vi.stubGlobal('awslambda', {
    streamifyResponse: (function_: unknown) => function_,
    HttpResponseStream: {
      from: (
        responseStream: ReturnType<typeof createResponseStream>,
        _metadata: { statusCode: number; headers?: Record<string, string> },
      ) => responseStream,
    },
  });

  const agentStreamModule = await import('./agent-stream.ts');
  testEnv.handler = agentStreamModule.handler as unknown as HandlerFunction;
});

beforeEach(() => {
  process.env.AGENT_RUNTIME_ARN = AGENT_RUNTIME_ARN;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.AGENT_RUNTIME_ARN;
});

function makeEvent(
  body: unknown,
  headers: Record<string, string> = DEFAULT_HEADERS,
): APIGatewayProxyEvent {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  } as unknown as APIGatewayProxyEvent;
}

async function runAndGetErrorBody(
  body: unknown,
  headers?: Record<string, string>,
) {
  const responseStream = createResponseStream();
  await testEnv.handler(makeEvent(body, headers), responseStream, {});
  return {
    responseStream,
    parsed: JSON.parse(writtenText(responseStream)),
  };
}

function expectValidationIssue(
  details: Array<{ path: string; message?: string }>,
  path: string,
) {
  expect(details).toEqual(
    expect.arrayContaining([expect.objectContaining({ path })]),
  );
}

describe('handler', () => {
  describe('configuration', () => {
    it('returns 500 JSON when AGENT_RUNTIME_ARN is not configured', async () => {
      delete process.env.AGENT_RUNTIME_ARN;
      const { parsed, responseStream } = await runAndGetErrorBody({
        threadId: VALID_THREAD_ID,
        messages: VALID_MESSAGES,
      });

      expect(parsed).toEqual({ error: 'AGENT_RUNTIME_ARN is not configured' });
      expect(responseStream.end).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('request headers', () => {
    it('returns 400 when end-user-id header is missing', async () => {
      const { parsed } = await runAndGetErrorBody(
        { threadId: VALID_THREAD_ID, messages: VALID_MESSAGES },
        {},
      );

      expect(parsed.error).toBe('Invalid request headers');
      expectValidationIssue(parsed.details, 'end-user-id');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('request body parsing', () => {
    it('returns 400 JSON for invalid JSON body', async () => {
      const responseStream = createResponseStream();
      const event = {
        body: '{not valid json',
        headers: DEFAULT_HEADERS,
      } as unknown as APIGatewayProxyEvent;

      await testEnv.handler(event, responseStream, {});

      expect(JSON.parse(writtenText(responseStream))).toEqual({
        error: 'Invalid JSON in request body',
      });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('request body validation', () => {
    it('returns 400 with validation details when schema validation occurs', async () => {
      const { parsed } = await runAndGetErrorBody({
        threadId: 'not-a-uuid',
      });

      expect(parsed.error).toBe('Invalid request body');
      expect(parsed.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'threadId' }),
          expect.objectContaining({ path: 'messages' }),
        ]),
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('returns 400 with validation details when schema validation occurs for nested fields', async () => {
      const { parsed } = await runAndGetErrorBody({
        threadId: VALID_THREAD_ID,
        messages: [{ id: 'msg-1', role: 'user', content: '' }],
      });

      expect(parsed.error).toBe('Invalid request body');
      expectValidationIssue(parsed.details, 'messages.0.content');
    });
  });

  describe('successful invocation', () => {
    it('invokes the agent runtime with the full payload and streams AG-UI events back', async () => {
      const responseStream = createResponseStream();

      const events: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
        },
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'msg-1',
          role: 'assistant',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg-1',
          delta: 'Statutory Sick Pay ',
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg-1',
          delta: 'is a weekly payment.',
        },
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: 'msg-1',
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
        },
      ];
      send.mockResolvedValueOnce({ response: aguiEventStream(events) });

      const requestBody = {
        threadId: VALID_THREAD_ID,
        runId: VALID_RUN_ID,
        state: {},
        forwardedProps: {},
        tools: [],
        context: [],
        messages: VALID_MESSAGES,
      };

      await testEnv.handler(makeEvent(requestBody), responseStream, {});

      expect(writtenText(responseStream)).toBe(
        events.map((event) => encoder.encode(event)).join(''),
      );
      expect(responseStream.end).toHaveBeenCalledOnce();
      expect(InvokeAgentRuntimeCommand).toHaveBeenCalledWith({
        agentRuntimeArn: AGENT_RUNTIME_ARN,
        runtimeSessionId: VALID_THREAD_ID,
        contentType: 'application/json',
        accept: 'text/event-stream',
        qualifier: 'DEFAULT',
        payload: JSON.stringify({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          state: {},
          messages: VALID_MESSAGES,
          tools: [],
          context: [],
          forwardedProps: {
            endUserId: VALID_USER_ID,
          },
        }),
      });
    });
  });

  describe('agent runtime failures', () => {
    it('emits synthetic RUN_STARTED followed by RUN_ERROR when runtime fails before RUN_STARTED', async () => {
      const responseStream = createResponseStream();
      const errorMessage = 'Invocation error';
      send.mockRejectedValueOnce(new Error(errorMessage));

      await testEnv.handler(
        makeEvent({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        }),
        responseStream,
        {},
      );

      const expectedStartEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: VALID_THREAD_ID,
        runId: VALID_RUN_ID,
      };
      const expectedErrorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: errorMessage,
      };

      expect(writtenText(responseStream)).toBe(
        encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
      );
      expect(responseStream.end).toHaveBeenCalledOnce();
    });

    it('emits synthetic RUN_STARTED followed by RUN_ERROR when no response body is returned', async () => {
      const responseStream = createResponseStream();
      send.mockResolvedValueOnce({ response: undefined });

      await testEnv.handler(
        makeEvent({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        }),
        responseStream,
        {},
      );

      const expectedStartEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: VALID_THREAD_ID,
        runId: VALID_RUN_ID,
      };
      const expectedErrorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: 'No response body from agent runtime',
      };

      expect(writtenText(responseStream)).toBe(
        encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
      );
      expect(responseStream.end).toHaveBeenCalledOnce();
    });

    it('does not duplicate RUN_STARTED if stream fails after RUN_STARTED was already sent', async () => {
      const responseStream = createResponseStream();

      const runStartedEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: VALID_THREAD_ID,
        runId: VALID_RUN_ID,
      };

      async function* failingStream() {
        yield Buffer.from(encoder.encode(runStartedEvent));
        throw new Error('Stream connection dropped');
      }

      send.mockResolvedValueOnce({ response: failingStream() });

      await testEnv.handler(
        makeEvent({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        }),
        responseStream,
        {},
      );

      const expectedErrorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: 'Stream connection dropped',
      };

      expect(writtenText(responseStream)).toBe(
        encoder.encode(runStartedEvent) + encoder.encode(expectedErrorEvent),
      );
      expect(responseStream.end).toHaveBeenCalledOnce();
    });
  });
});
