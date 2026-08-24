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
  type JsonErrorResponse,
} from '../../http/errors.ts';
import { logger } from '../../logging/logger.ts';
import { relayAgentEventStream } from '../../streaming/agent-event-stream.ts';

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN is not configured');
}

const client = new BedrockAgentCoreClient({});

interface AgentEventStreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

type InvokeEvent = ValidatedBodyEvent<RunAgentInputBody> &
  ValidatedHeadersEvent<ClientInputHeaders>;

async function invokeAgent(
  event: InvokeEvent,
): Promise<AgentEventStreamResponse | JsonErrorResponse> {
  const endUserId = event.headers['end-user-id'];
  const body = event.body;

  const payload = {
    threadId: body.threadId,
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
      runtimeSessionId: body.threadId,
      contentType: 'application/json',
      accept: 'text/event-stream',
      qualifier: 'DEFAULT',
      payload: JSON.stringify(payload),
    });

    response = await client.send(command);
  } catch (error) {
    logger.error('Agent runtime invocation failed', {
      error,
      threadId: body.threadId,
      runId: body.runId,
    });
    return buildJsonErrorResponse(500, { error: 'Agent invocation error' });
  }

  // The SDK types 'response.response' as optional, so we guard against
  // it being absent even though the runtime should always return a body.
  if (!response.response) {
    logger.error('Agent runtime returned no response body', {
      threadId: body.threadId,
      runId: body.runId,
    });
    return buildJsonErrorResponse(500, { error: 'Agent invocation error' });
  }

  const agentEvents = relayAgentEventStream({
    source: response.response as AsyncIterable<Uint8Array>,
    threadId: body.threadId,
    runId: body.runId,
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
  .handler(invokeAgent);
