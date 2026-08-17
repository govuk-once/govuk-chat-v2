import { PassThrough } from 'node:stream';
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
  threadId: string;
  runId: string;
}

/**
 * Relays an AG-UI SSE byte stream from an agent runtime onto a PassThrough
 * stream suitable for a Lambda streaming response. If the source stream
 * fails, emits a synthetic RUN_STARTED (unless one was already seen) followed
 * by a RUN_ERROR event so the client always receives a well-formed run.
 */
export function relayAgentEventStream({
  source,
  threadId,
  runId,
}: RelayAgentEventStreamParameters): PassThrough {
  const sseStream = new PassThrough();

  (async () => {
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
          threadId,
          runId,
        };
        sseStream.write(encoder.encodeSSE(startEvent));
      }

      sseStream.write(encoder.encodeSSE(errorEvent));
    } finally {
      sseStream.end();
    }
  })();

  return sseStream;
}
