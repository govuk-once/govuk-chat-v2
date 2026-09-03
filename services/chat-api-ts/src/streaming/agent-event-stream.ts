import {
  EventType,
  type BaseEvent,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { logger } from '../logging/logger.ts';

const encoder = new EventEncoder();

type RelayedEvent = BaseEvent & { threadId?: string };

export interface RelayAgentEventStreamParameters {
  source: AsyncIterable<Uint8Array>;
  userThreadId: string;
  systemThreadId: string;
  runId: string;
}

export async function* relayAgentEventStream({
  source,
  userThreadId,
  systemThreadId,
  runId,
}: RelayAgentEventStreamParameters): AsyncGenerator<string> {
  let isRunStarted = false;
  const textDecoder = new TextDecoder('utf-8');
  const parsedEvents: RelayedEvent[] = [];
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      parsedEvents.push(JSON.parse(event.data) as RelayedEvent);
    },
  });

  try {
    for await (const chunk of source) {
      parser.feed(textDecoder.decode(chunk, { stream: true }));

      const completedEvents = [...parsedEvents];
      parsedEvents.length = 0;
      for (const event of completedEvents) {
        if (event.type === EventType.RUN_STARTED) {
          isRunStarted = true;
        }
        if ('threadId' in event) {
          event.threadId = userThreadId;
        }
        yield encoder.encodeSSE(event);
      }
    }
  } catch (error) {
    logger.error('Agent event stream relay failed', {
      error,
      threadId: systemThreadId,
      userThreadId,
      runId,
    });

    const errorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    if (!isRunStarted) {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: userThreadId,
        runId,
      };
      yield encoder.encodeSSE(startEvent);
    }

    yield encoder.encodeSSE(errorEvent);
  }
}
