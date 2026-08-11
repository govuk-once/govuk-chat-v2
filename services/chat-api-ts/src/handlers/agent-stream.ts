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
import { RunAgentInputSchema } from './schemas.ts';

const client = new BedrockAgentCoreClient({});
const encoder = new EventEncoder();

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEvent,
    responseStream: Writable,
  ): Promise<void> => {
    const failEarly = (
      statusCode: number,
      body: Record<string, unknown>,
    ): void => {
      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
      stream.write(JSON.stringify(body));
      stream.end();
    };

    const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
    if (!agentRuntimeArn) {
      return failEarly(500, { error: 'AGENT_RUNTIME_ARN is not configured' });
    }

    const endUserId = event.headers?.['end-user-id'];
    if (!endUserId) {
      return failEarly(400, {
        error: 'Invalid request headers',
        details: [
          { path: 'end-user-id', message: 'end-user-id header is required' },
        ],
      });
    }

    let rawBody: unknown;
    try {
      rawBody = event.body ? JSON.parse(event.body) : {};
    } catch {
      return failEarly(400, { error: 'Invalid JSON in request body' });
    }

    const parseResult = RunAgentInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const details = parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return failEarly(400, { error: 'Invalid request body', details });
    }

    const body = parseResult.data;
    const runId = body.runId ?? crypto.randomUUID();

    const payload = {
      threadId: body.threadId,
      runId,
      state: body.state ?? {},
      messages: body.messages ?? [],
      tools: body.tools ?? [],
      context: body.context ?? [],
      forwardedProps: { endUserId: endUserId },
    };

    const sseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    try {
      const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn,
        runtimeSessionId: body.threadId,
        contentType: 'application/json',
        accept: 'text/event-stream',
        qualifier: 'DEFAULT',
        payload: JSON.stringify(payload),
      });

      const response = await client.send(command);

      if (!response.response) {
        throw new Error('No response body from agent runtime');
      }

      for await (const chunk of response.response as AsyncIterable<Uint8Array>) {
        sseStream.write(chunk);
      }
    } catch (error) {
      const errorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to invoke agent runtime',
      };
      sseStream.write(encoder.encode(errorEvent));
    } finally {
      sseStream.end();
    }
  },
);
