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

/**
 * Relays an AG-UI SSE byte stream from an agent runtime onto a writable
 * destination. If the source stream fails, emits a synthetic RUN_STARTED
 * (unless one was already seen) followed by a RUN_ERROR event so the client
 * always receives a well-formed run. Resolves once the destination has been
 * ended.
 */
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
