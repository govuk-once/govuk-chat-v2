import type { Writable } from 'node:stream';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  EventType,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import {
  RunAgentInputSchema,
  ClientInputHeadersSchema,
} from '../../schemas/client-input.ts';
import { writeJsonErrorResponse } from '../../http/errors.ts';
import { lowercaseHeaders } from '../../http/headers.ts';
import { z } from 'zod';

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN is not configured');
}

const client = new BedrockAgentCoreClient({});
const encoder = new EventEncoder();
const textDecoder = new TextDecoder('utf-8');

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEvent,
    responseStream: Writable,
  ): Promise<void> => {
    const parsedHeader = ClientInputHeadersSchema.safeParse(
      lowercaseHeaders(event.headers),
    );
    if (!parsedHeader.success) {
      return writeJsonErrorResponse(responseStream, 400, {
        error: 'Invalid request headers',
        details: z.flattenError(parsedHeader.error),
      });
    }

    const endUserId = parsedHeader.data['end-user-id'];

    let rawBody: unknown;
    try {
      rawBody = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      return writeJsonErrorResponse(responseStream, 400, {
        error: 'Invalid JSON in request body',
      });
    }

    const parseResult = RunAgentInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return writeJsonErrorResponse(responseStream, 422, {
        error: 'Invalid request body',
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

      if (!response.response) {
        throw new Error('No response body from agent runtime');
      }
    } catch {
      // TODO: Log error here.
      return writeJsonErrorResponse(responseStream, 500, {
        error: 'Failed to invoke agent runtime',
      });
    }

    const sseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    let isRunStarted = false;

    try {
      for await (const chunk of response.response as AsyncIterable<Uint8Array>) {
        const sseChunk = textDecoder.decode(chunk, { stream: true });

        if (!sseChunk.trim()) continue;

        if (!isRunStarted) {
          const dataLine = sseChunk
            .split('\n')
            .find((line) => line.trimStart().startsWith('data:'));

          if (dataLine) {
            try {
              const parsed = JSON.parse(dataLine.replace(/^data:\s*/, ''));
              if (parsed.type === EventType.RUN_STARTED) {
                isRunStarted = true;
              }
            } catch (error) {
              // Ignore JSON parsing errors
              if (!(error instanceof SyntaxError)) {
                throw error;
              }
            }
          }
        }

        sseStream.write(sseChunk);
      }
    } catch {
      // TODO: Log error here.
      const errorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: 'Agent invocation error',
      };

      if (!isRunStarted) {
        const startEvent: RunStartedEvent = {
          type: EventType.RUN_STARTED,
          threadId: body.threadId,
          runId,
        };
        sseStream.write(encoder.encodeSSE(startEvent));
      }

      sseStream.write(encoder.encodeSSE(errorEvent));
    } finally {
      sseStream.end();
    }
  },
);
