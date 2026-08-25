import type { Writable } from 'node:stream';
import {
  EventType,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { logger } from '../logging/logger.ts';

const encoder = new EventEncoder();

export interface RelayAgentEventStreamParameters {
  source: AsyncIterable<Uint8Array>;
  destination: Writable;
  threadId: string;
  runId: string;
}
export async function relayAgentEventStream({
  source,
  destination,
  threadId,
  runId,
}: RelayAgentEventStreamParameters): Promise<void> {
  let isRunStarted = false;
  const textDecoder = new TextDecoder('utf-8');
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      const parsed = JSON.parse(event.data);
      if (parsed.type === EventType.RUN_STARTED) {
        isRunStarted = true;
      }
    },
  });

  try {
    for await (const chunk of source) {
      if (!isRunStarted) {
        const sseChunk = textDecoder.decode(chunk, { stream: true });
        if (sseChunk.trim()) {
          parser.feed(sseChunk);
        }
      }

      destination.write(chunk);
    }
  } catch (error) {
    logger.error('Agent event stream relay failed', {
      error,
      threadId,
      runId,
    });

    const errorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    if (!isRunStarted) {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
      };
      destination.write(encoder.encodeSSE(startEvent));
    }

    destination.write(encoder.encodeSSE(errorEvent));
  } finally {
    destination.end();
  }
}
