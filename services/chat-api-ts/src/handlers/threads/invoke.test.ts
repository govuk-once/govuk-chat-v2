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
const DEFAULT_HEADERS = { 'end-user-id': VALID_USER_ID };
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
  return {
    responseStream,
    parsed: JSON.parse(writtenText(responseStream)),
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
    it('returns 400 when end-user-id header is missing', async () => {
      const { parsed } = await runAndGetErrorBody(
        { threadId: VALID_THREAD_ID, messages: VALID_MESSAGES },
        {},
      );

      expect(parsed.error).toBe('Invalid request headers');
      expectFieldError(parsed.details, 'end-user-id');
      expect(send).not.toHaveBeenCalled();
    });

    it('normalises header keys to lowercase before validation', async () => {
      const { parsed } = await runAndGetErrorBody(
        { threadId: VALID_THREAD_ID, messages: VALID_MESSAGES },
        { 'End-User-Id': VALID_USER_ID },
      );

      expect(parsed.error).toBe('Invalid request body');
      expect(parsed.details.fieldErrors).not.toHaveProperty('end-user-id');
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
        const responseStream = createResponseStream();
        send.mockRejectedValueOnce(new Error('Error from agent runtime'));

        await testEnv.handler(
          makeEvent({
            threadId: VALID_THREAD_ID,
            runId: VALID_RUN_ID,
            messages: VALID_MESSAGES,
          }),
          responseStream,
          {},
        );

        expect(JSON.parse(writtenText(responseStream))).toEqual({
          error: 'Failed to invoke agent runtime',
        });
        expect(responseStream.end).toHaveBeenCalledOnce();
      });

      it('returns 500 JSON error when no response body is returned from agent runtime', async () => {
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

        expect(JSON.parse(writtenText(responseStream))).toEqual({
          error: 'Failed to invoke agent runtime',
        });
        expect(responseStream.end).toHaveBeenCalledOnce();
      });
    });

    describe('mid-stream failures', () => {
      it('emits synthetic RUN_STARTED followed by RUN_ERROR when response stream fails before RUN_STARTED chunk', async () => {
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

        const expectedStartEvent: RunStartedEvent = {
          type: EventType.RUN_STARTED,
          threadId: VALID_THREAD_ID,
          runId: VALID_RUN_ID,
        };
        const expectedErrorEvent: RunErrorEvent = {
          type: EventType.RUN_ERROR,
          message: 'Agent invocation error',
        };

        expect(writtenText(responseStream)).toBe(
          encoder.encode(expectedStartEvent) +
            encoder.encode(expectedErrorEvent),
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

        send.mockResolvedValueOnce({
          response: createFailingStream([encoder.encode(runStartedEvent)]),
        });

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
          message: 'Agent invocation error',
        };

        expect(writtenText(responseStream)).toBe(
          encoder.encode(runStartedEvent) + encoder.encode(expectedErrorEvent),
        );
        expect(responseStream.end).toHaveBeenCalledOnce();
      });
    });
  });
});
