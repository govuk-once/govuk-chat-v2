import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  EventType,
  type BaseEvent,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import {
  send,
  encoder,
  invokeAgentRuntimeCommand,
  stubAwsLambdaGlobal,
  createResponseStream,
  writtenText,
  aguiEventStream,
  createFailingStream,
} from '../../test-utils/agent-stream.ts';

type HandlerFunction = (
  event: APIGatewayProxyEvent,
  responseStream: ReturnType<typeof createResponseStream>,
  context?: unknown,
) => Promise<void>;

const testEnv = {} as { handler: HandlerFunction };

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_RUN_ID = crypto.randomUUID();
const VALID_USER_ID = 'user-abc-123';
const DEFAULT_HEADERS = {
  'end-user-id': VALID_USER_ID,
  'content-type': 'application/json',
};
const AGENT_RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:eu-west-1:123456789012:runtime/test';
const VALID_MESSAGES = [
  { id: crypto.randomUUID(), role: 'user', content: 'Tell me about SSP' },
];

beforeAll(async () => {
  stubAwsLambdaGlobal();
  vi.stubEnv('AGENT_RUNTIME_ARN', AGENT_RUNTIME_ARN);

  const agentStreamModule = await import('./invoke.ts');
  testEnv.handler = agentStreamModule.handler as unknown as HandlerFunction;
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
  const text = await writtenText(responseStream);
  return {
    responseStream,
    parsed: JSON.parse(text),
  };
}

function expectFieldError(
  details: { fieldErrors?: Record<string, string[]> },
  field: string,
) {
  expect(details.fieldErrors).toHaveProperty(field);
}

describe('handler', () => {
  describe('configuration', () => {
    it('throws an error during module import when AGENT_RUNTIME_ARN is not configured', async () => {
      vi.resetModules();
      vi.stubEnv('AGENT_RUNTIME_ARN', undefined);

      await expect(import('./invoke.ts')).rejects.toThrow(
        'AGENT_RUNTIME_ARN is not configured',
      );
    });
  });

  describe('request headers', () => {
    it('returns 422 when end-user-id header is missing', async () => {
      const { parsed } = await runAndGetErrorBody(
        {
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        },
        { 'content-type': 'application/json' },
      );

      expect(parsed.error).toBe('Invalid request headers');
      expectFieldError(parsed.details, 'end-user-id');
      expect(send).not.toHaveBeenCalled();
    });

    it('normalises header keys to lowercase before validation', async () => {
      const { parsed } = await runAndGetErrorBody(
        { threadId: VALID_THREAD_ID, messages: VALID_MESSAGES },
        { 'End-User-Id': VALID_USER_ID, 'content-type': 'application/json' },
      );

      expect(parsed.error).toBe('Invalid request body');
      expectFieldError(parsed.details, 'runId');
    });
  });

  describe('request body parsing', () => {
    // Middy return a 422 for malformend JSON where you'd expect it to be a 400.
    it('returns 422 as plain text for malformed JSON body', async () => {
      const responseStream = createResponseStream();
      const event = {
        body: '{not valid json',
        headers: DEFAULT_HEADERS,
      } as unknown as APIGatewayProxyEvent;

      await testEnv.handler(event, responseStream, {});
      const text = await writtenText(responseStream);

      expect(text).toContain('Invalid or malformed JSON was provided');
      expect(send).not.toHaveBeenCalled();
    });

    it('returns 415 when Content-Type is missing or not JSON', async () => {
      const responseStream = createResponseStream();

      await testEnv.handler(
        makeEvent(
          { threadId: VALID_THREAD_ID, messages: VALID_MESSAGES },
          { 'end-user-id': VALID_USER_ID },
        ),
        responseStream,
        {},
      );
      const text = await writtenText(responseStream);

      expect(text).toBeTruthy();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('request body validation', () => {
    it('returns 422 with validation details when schema validation occurs', async () => {
      const { parsed } = await runAndGetErrorBody({
        threadId: 'not-a-uuid',
      });

      expect(parsed.error).toBe('Invalid request body');
      expectFieldError(parsed.details, 'threadId');
      expectFieldError(parsed.details, 'messages');
      expect(send).not.toHaveBeenCalled();
    });

    it('returns 422 with validation details when schema validation occurs for nested fields', async () => {
      const { parsed } = await runAndGetErrorBody({
        threadId: VALID_THREAD_ID,
        messages: [{ id: 'msg-1', role: 'user', content: '' }],
      });

      expect(parsed.error).toBe('Invalid request body');
      expectFieldError(parsed.details, 'messages');
    });

    it('returns a 422 when end-user-id is missing from the headers', async () => {
      const { parsed } = await runAndGetErrorBody(
        { threadId: 'not-a-uuid' },
        { 'content-type': 'application/json' },
      );

      expect(parsed.error).toBe('Invalid request headers');
      expectFieldError(parsed.details, 'end-user-id');
      expect(send).not.toHaveBeenCalled();
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
      const text = await writtenText(responseStream);

      expect(text).toBe(events.map((event) => encoder.encode(event)).join(''));
      expect(invokeAgentRuntimeCommand).toHaveBeenCalledWith({
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
    describe('pre-stream failures', () => {
      it('returns 500 JSON error when runtime client invocation fails before opening stream', async () => {
        send.mockRejectedValueOnce(new Error('Error from agent runtime'));

        const { parsed } = await runAndGetErrorBody({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        });

        expect(parsed).toEqual({ error: 'Failed to invoke agent runtime' });
      });

      it('returns 500 JSON error when no response body is returned from agent runtime', async () => {
        send.mockResolvedValueOnce({ response: undefined });

        const { parsed } = await runAndGetErrorBody({
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
          messages: VALID_MESSAGES,
        });

        expect(parsed).toEqual({ error: 'Failed to invoke agent runtime' });
      });
    });

    describe('mid-stream failures', () => {
      it('emits a RunError event when the stream throws an error', async () => {
        const responseStream = createResponseStream();
        send.mockResolvedValueOnce({ response: createFailingStream() });

        await testEnv.handler(
          makeEvent({
            threadId: VALID_THREAD_ID,
            runId: VALID_RUN_ID,
            messages: VALID_MESSAGES,
          }),
          responseStream,
          {},
        );
        const text = await writtenText(responseStream);

        const expectedStartEvent: RunStartedEvent = {
          type: EventType.RUN_STARTED,
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
        };
        const expectedErrorEvent: RunErrorEvent = {
          type: EventType.RUN_ERROR,
          message: 'Agent invocation error',
        };

        expect(text).toBe(
          encoder.encode(expectedStartEvent) +
            encoder.encode(expectedErrorEvent),
        );
      });
    });
  });
});
