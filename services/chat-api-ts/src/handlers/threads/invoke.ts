import middy from '@middy/core';
import { executionModeStreamifyResponse } from '@middy/core/StreamifyResponse';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import httpErrorHandler from '@middy/http-error-handler';
import type { APIGatewayProxyEvent } from 'aws-lambda';
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
} from '../../http/zod-validator.ts';
import { buildJsonErrorResponse } from '../../http/errors.ts';
import { relayAgentEventStream } from '../../streaming/agent-event-stream.ts';

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN is not configured');
}

const client = new BedrockAgentCoreClient({});

type ValidatedEvent = Omit<APIGatewayProxyEvent, 'body' | 'headers'> & {
  body: RunAgentInputBody;
  headers: ClientInputHeaders;
};

const baseHandler = async (event: ValidatedEvent) => {
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

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    runtimeSessionId: body.threadId,
    contentType: 'application/json',
    accept: 'text/event-stream',
    qualifier: 'DEFAULT',
    payload: JSON.stringify(payload),
  });

  let response;
  try {
    response = await client.send(command);
  } catch {
    return buildJsonErrorResponse(500, {
      error: 'Failed to invoke agent runtime',
    });
  }

  if (!response.response) {
    return buildJsonErrorResponse(500, {
      error: 'Failed to invoke agent runtime',
    });
  }

  const sseStream = relayAgentEventStream({
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
    body: sseStream,
  };
};

export const handler = middy<ValidatedEvent>({
  executionMode: executionModeStreamifyResponse,
})
  .handler(baseHandler)
  .use(httpHeaderNormalizer())
  .use(zodHeadersValidator(ClientInputHeadersSchema))
  .use(httpJsonBodyParser())
  .use(zodBodyValidator(RunAgentInputSchema))
  // I've set this to false for now since it outputs to STDOUT by default.
  .use(httpErrorHandler({ logger: false }));
