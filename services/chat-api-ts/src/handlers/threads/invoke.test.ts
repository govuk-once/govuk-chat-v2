import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { logger } from '../../logging/logger.ts';
import {
  send,
  encoder,
  invokeAgentRuntimeCommand,
  stubAwsLambdaGlobal,
  stubBedrockAgentCoreClient,
  createResponseStream,
  expectJsonHttpResponse,
  aguiEventStream,
  createFailingStream,
  type ResponseStream,
} from '../../test-utils/agent-stream.ts';
import { apiGatewayProxyEventFixture } from '../../test-utils/api-gateway.ts';

type StreamifiedHandler = (
  event: APIGatewayProxyEvent,
  responseStream: ResponseStream,
  context: unknown,
) => Promise<void>;

const testEnv = {} as {
  handler: StreamifiedHandler;
  responseStream: ResponseStream;
};

beforeEach(() => {
  testEnv.responseStream = createResponseStream();
});

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_RUN_ID = crypto.randomUUID();
const VALID_USER_ID = crypto.randomUUID();
const END_USER_ID_HEADER = { 'end-user-id': VALID_USER_ID };
const AGENT_RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:eu-west-1:123456789012:runtime/test';
const VALID_MESSAGES = [
  { id: crypto.randomUUID(), role: 'user', content: 'Tell me about SSP' },
];

beforeAll(async () => {
  stubAwsLambdaGlobal();
  stubBedrockAgentCoreClient();
  vi.stubEnv('AGENT_RUNTIME_ARN', AGENT_RUNTIME_ARN);

  const agentStreamModule = await import('./invoke.ts');
  testEnv.handler = agentStreamModule.handler as unknown as StreamifiedHandler;
});

async function runHandler(event: APIGatewayProxyEvent): Promise<void> {
  await testEnv.handler(event, testEnv.responseStream, {});
}

function fieldErrorResponse(error: string, fields: string[]): unknown {
  return expect.objectContaining({
    error,
    details: expect.objectContaining({
      fieldErrors: expect.objectContaining(
        Object.fromEntries(fields.map((field) => [field, expect.anything()])),
      ),
    }),
  });
}

describe('configuration', () => {
  it('throws an error during module import when AGENT_RUNTIME_ARN is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_RUNTIME_ARN', undefined);

    await expect(import('./invoke.ts')).rejects.toThrow(
      'AGENT_RUNTIME_ARN is not configured',
    );
  });
});

describe('handler', () => {
  describe('request headers', () => {
    it('returns 422 when end-user-id header is missing', async () => {
      await runHandler(
        apiGatewayProxyEventFixture(
          JSON.stringify({
            threadId: VALID_THREAD_ID,
            messages: VALID_MESSAGES,
          }),
          {},
        ),
      );

      expectJsonHttpResponse(
        testEnv.responseStream,
        422,
        fieldErrorResponse('Agent invocation error', ['end-user-id']),
      );
    });

    it('normalises header keys before validation', async () => {
      await runHandler(
        apiGatewayProxyEventFixture(
          JSON.stringify({
            threadId: VALID_THREAD_ID,
            messages: VALID_MESSAGES,
          }),
          { 'End-User-Id': VALID_USER_ID },
        ),
      );

      expectJsonHttpResponse(
        testEnv.responseStream,
        422,
        fieldErrorResponse('Agent invocation error', ['runId']),
      );
    });
  });

  describe('request body parsing', () => {
    it('returns a 422 for a malformed JSON body', async () => {
      const logWarn = vi.spyOn(logger, 'warn');
      const logError = vi.spyOn(logger, 'error');

      await runHandler(
        apiGatewayProxyEventFixture('{not valid json', END_USER_ID_HEADER),
      );

      expectJsonHttpResponse(testEnv.responseStream, 422, {
        error: 'Invalid or malformed JSON was provided',
      });
      expect(logWarn).toHaveBeenCalledWith(
        'Request rejected before reaching the handler',
        { error: expect.any(Error), statusCode: 422 },
      );
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('request body validation', () => {
    it('returns 422 with validation details when schema validation occurs', async () => {
      await runHandler(
        apiGatewayProxyEventFixture(
          JSON.stringify({ threadId: 'not-a-uuid' }),
          END_USER_ID_HEADER,
        ),
      );

      expectJsonHttpResponse(
        testEnv.responseStream,
        422,
        fieldErrorResponse('Agent invocation error', ['threadId', 'messages']),
      );
    });

    it('returns 422 with validation details when schema validation occurs for nested fields', async () => {
      await runHandler(
        apiGatewayProxyEventFixture(
          JSON.stringify({
            threadId: VALID_THREAD_ID,
            messages: [{ id: 'msg-1', role: 'user', content: '' }],
          }),
          END_USER_ID_HEADER,
        ),
      );

      expectJsonHttpResponse(
        testEnv.responseStream,
        422,
        fieldErrorResponse('Agent invocation error', ['messages']),
      );
    });
  });

  describe('successful invocation', () => {
    it('invokes the agent runtime with the full payload and streams AG-UI events back', async () => {
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

      await runHandler(
        apiGatewayProxyEventFixture(
          JSON.stringify(requestBody),
          END_USER_ID_HEADER,
        ),
      );

      expect(testEnv.responseStream.read()).toBe(
        events.map((event) => encoder.encode(event)).join(''),
      );
      expect(invokeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          agentRuntimeArn: AGENT_RUNTIME_ARN,
          runtimeSessionId: VALID_THREAD_ID,
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
        }),
      );
    });
  });

  describe('agent runtime failures', () => {
    describe('pre-stream failures', () => {
      it('returns a 500 JSON error when runtime client invocation fails before opening stream', async () => {
        const logError = vi.spyOn(logger, 'error');
        const runtimeError = new Error('Error from agent runtime');
        send.mockRejectedValueOnce(runtimeError);

        await runHandler(
          apiGatewayProxyEventFixture(
            JSON.stringify({
              threadId: VALID_THREAD_ID,
              runId: VALID_RUN_ID,
              messages: VALID_MESSAGES,
            }),
            END_USER_ID_HEADER,
          ),
        );

        expectJsonHttpResponse(testEnv.responseStream, 500, {
          error: 'Agent invocation error',
        });
        expect(logError).toHaveBeenCalledWith(
          'Agent runtime invocation failed',
          {
            error: runtimeError,
            threadId: VALID_THREAD_ID,
            runId: VALID_RUN_ID,
          },
        );
      });

      it('returns a 500 JSON error when no response body is returned from agent runtime', async () => {
        const logError = vi.spyOn(logger, 'error');
        send.mockResolvedValueOnce({ response: undefined });

        await runHandler(
          apiGatewayProxyEventFixture(
            JSON.stringify({
              threadId: VALID_THREAD_ID,
              runId: VALID_RUN_ID,
              messages: VALID_MESSAGES,
            }),
            END_USER_ID_HEADER,
          ),
        );

        expectJsonHttpResponse(testEnv.responseStream, 500, {
          error: 'Agent invocation error',
        });
        expect(logError).toHaveBeenCalledWith(
          'Agent runtime returned no response body',
          { threadId: VALID_THREAD_ID, runId: VALID_RUN_ID },
        );
      });
    });

    describe('mid-stream failures', () => {
      it('emits synthetic RUN_STARTED followed by RUN_ERROR when response stream fails before RUN_STARTED chunk', async () => {
        send.mockResolvedValueOnce({ response: createFailingStream() });

        await runHandler(
          apiGatewayProxyEventFixture(
            JSON.stringify({
              threadId: VALID_THREAD_ID,
              runId: VALID_RUN_ID,
              messages: VALID_MESSAGES,
            }),
            END_USER_ID_HEADER,
          ),
        );

        expect(testEnv.responseStream.read()).toContain(EventType.RUN_ERROR);
      });
    });
  });
});
