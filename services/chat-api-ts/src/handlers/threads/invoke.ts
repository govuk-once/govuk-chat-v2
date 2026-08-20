import type { Writable } from 'node:stream';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { RunAgentInputSchema } from '../../schemas/client-input.ts';
import { streamedJsonErrorResponse } from '../../http/errors.ts';
import { parseEndUserId } from '../../http/headers.ts';
import { relayAgentEventStream } from '../../streaming/agent-event-stream.ts';
import { z } from 'zod';

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN is not configured');
}

const client = new BedrockAgentCoreClient({});

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEvent,
    responseStream: Writable,
  ): Promise<void> => {
    const headerResult = parseEndUserId(event.headers);
    if (!headerResult.success) {
      return streamedJsonErrorResponse(responseStream, 422, {
        error: 'Agent invocation error',
        details: headerResult.error,
      });
    }

    const { endUserId } = headerResult;

    // TODO: Extract request body parsing/validation into a shared helper if
    // other handlers end up needing the same JSON parsing + Zod validation.
    let rawBody: unknown;
    try {
      rawBody = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      // JSON parsing errors throw SyntaxErrors
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      // TODO: log error here
      return streamedJsonErrorResponse(responseStream, 400, {
        error: 'Invalid JSON in request body',
      });
    }

    const parseResult = RunAgentInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      // TODO: log error here
      return streamedJsonErrorResponse(responseStream, 422, {
        error: 'Agent invocation error',
        details: z.flattenError(parseResult.error),
      });
    }

    const body = parseResult.data;
    const runId = body.runId;

    const payload = {
      threadId: body.threadId,
      runId,
      state: body.state ?? {},
      messages: body.messages ?? [],
      tools: body.tools ?? [],
      context: body.context ?? [],
      forwardedProps: { ...(endUserId && { endUserId }) },
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

      // The SDK types 'response.response' as optional, so we guard against
      // it being absent even though the runtime should always return a body.
      if (!response.response) {
        // TODO: Log error here.
        throw new Error('Agent invocation error');
      }
    } catch {
      // TODO: Log error here.
      return streamedJsonErrorResponse(responseStream, 500, {
        error: 'Agent invocation error',
      });
    }

    const sseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    await relayAgentEventStream({
      source: response.response as AsyncIterable<Uint8Array>,
      destination: sseStream,
      threadId: body.threadId,
      runId,
    });
  },
);
