import type { Writable } from 'node:stream';
import {
  EventType,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';

const encoder = new EventEncoder();
const textDecoder = new TextDecoder('utf-8');

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

  try {
    for await (const chunk of source) {
      const sseChunk = textDecoder.decode(chunk, { stream: true });

      if (!sseChunk.trim()) continue;

      if (!isRunStarted) {
        // TODO: Look into using library to do this parsing for us.
        const dataLine = sseChunk
          .split('\n')
          .find((line) => line.trimStart().startsWith('data:'));

        if (dataLine) {
          const parsed = JSON.parse(dataLine.replace(/^data:\s*/, ''));
          if (parsed.type === EventType.RUN_STARTED) {
            isRunStarted = true;
          }
        }
      }

      destination.write(sseChunk);
    }
  } catch {
    // TODO: Log error here.
    // TODO: Look into if we should raise an error after we've finished writing to
    // the destination.
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
