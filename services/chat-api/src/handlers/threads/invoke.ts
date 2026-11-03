import { Readable } from 'node:stream';
import middy from '@middy/core';
import { executionModeStreamifyResponse } from '@middy/core/StreamifyResponse';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  RunAgentInputSchema,
  ClientInputHeadersSchema,
  type RunAgentInputBody,
  type ClientInputHeaders,
} from '../../schemas/client-input.ts';
import {
  zodBodyValidator,
  zodHeadersValidator,
  type ValidatedBodyEvent,
  type ValidatedHeadersEvent,
} from '../../http/zod-validator.ts';
import {
  buildJsonErrorResponse,
  jsonHttpErrorHandler,
  type JsonErrorResponse,
} from '../../http/errors.ts';
import { logger } from '../../logging/logger.ts';
import { resolveThread } from '../../persistence/threads.ts';
import {
  beginRun,
  finishRun,
  releaseRun,
  type RunClaim,
  type RunKey,
} from '../../persistence/runs.ts';
import { MessageAccumulator } from '../../streaming/message-accumulator.ts';
import { relayAgentEventStream } from '../../streaming/agent-event-stream.ts';

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN is not configured');
}

const client = new BedrockAgentCoreClient({});

const REJECTION_MESSAGES: Record<
  Exclude<RunClaim['status'], 'claimed'>,
  string
> = {
  'thread-busy': 'A run is already in progress on this thread',
  'duplicate-run': 'This run id has already been used on this thread',
  'duplicate-message': 'This message id has already been used on this thread',
};

interface AgentEventStreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

type InvokeEvent = ValidatedBodyEvent<RunAgentInputBody> &
  ValidatedHeadersEvent<ClientInputHeaders>;

async function releaseClaim(runKey: RunKey): Promise<void> {
  try {
    await releaseRun(runKey);
  } catch (error) {
    logger.error('Releasing the thread after a failed invocation failed', {
      error,
      messageId: runKey.messageId,
    });
  }
}

async function invokeAgent(
  event: InvokeEvent,
): Promise<AgentEventStreamResponse | JsonErrorResponse> {
  const endUserId = event.headers['end-user-id'];
  const body = event.body;
  logger.appendKeys({ userThreadId: body.threadId, runId: body.runId });

  const { systemThreadId } = await resolveThread({
    endUserId,
    userThreadId: body.threadId,
  });
  logger.appendKeys({ threadId: systemThreadId });

  const messageId = body.messages.at(-1)!.id;
  const runKey = { systemThreadId, runId: body.runId, messageId };

  const claim = await beginRun(runKey);
  if (claim.status !== 'claimed') {
    logger.warn('Run rejected before invoking the agent', {
      status: claim.status,
    });
    return buildJsonErrorResponse(409, {
      error: REJECTION_MESSAGES[claim.status],
    });
  }

  const payload = {
    threadId: systemThreadId,
    runId: body.runId,
    state: body.state ?? {},
    messages: body.messages ?? [],
    tools: body.tools ?? [],
    context: body.context ?? [],
    forwardedProps: { endUserId },
  };

  let response;
  try {
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn,
      runtimeSessionId: systemThreadId,
      contentType: 'application/json',
      accept: 'text/event-stream',
      qualifier: 'DEFAULT',
      payload: JSON.stringify(payload),
    });

    response = await client.send(command);
  } catch (error) {
    await releaseClaim(runKey);
    throw error;
  }

  // The SDK types 'response.response' as optional, so we guard against
  // it being absent even though the runtime should always return a body.
  if (!response.response) {
    await releaseClaim(runKey);
    throw new Error('Agent runtime returned no response body');
  }

  const lastMessage = body.messages.at(-1)!;
  const userMessage = {
    messageId: lastMessage.id,
    role: lastMessage.role,
    content: lastMessage.content,
    createdAt: new Date().toISOString(),
  };

  const accumulator = new MessageAccumulator();
  const agentEvents = relayAgentEventStream({
    source: response.response as AsyncIterable<Uint8Array>,
    userThreadId: body.threadId,
    systemThreadId,
    runId: body.runId,
    onRunFinished: () => {
      const assistantContent = accumulator.getContent();

      const messages = assistantContent
        ? [
            userMessage,
            {
              messageId: body.runId,
              role: 'assistant',
              content: assistantContent,
              createdAt: new Date().toISOString(),
            },
          ]
        : [userMessage];

      return finishRun(runKey, messages);
    },
    onRunFailed: () => releaseRun(runKey),
    onEvent: (event) => accumulator.process(event),
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
    body: Readable.from(agentEvents),
  };
}

export const handler = middy({
  executionMode: executionModeStreamifyResponse,
})
  .use(injectLambdaContext(logger, { resetKeys: true }))
  .use(httpHeaderNormalizer())
  .use(zodHeadersValidator(ClientInputHeadersSchema, 'Agent invocation error'))
  .use(httpJsonBodyParser())
  .use(zodBodyValidator(RunAgentInputSchema, 'Agent invocation error'))
  .use(jsonHttpErrorHandler('Agent invocation error'))
  .handler(invokeAgent);
