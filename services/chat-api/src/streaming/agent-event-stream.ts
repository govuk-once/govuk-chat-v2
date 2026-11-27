import {
  EventType,
  type BaseEvent,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { logger } from '../logging/logger.ts';
import {
  guardrailTraceIn,
  guardrailTriggeredEvent,
  isStoppedByGuardrail,
  isUserMessageBlocked,
  type BlockedMessage,
  type BlockedRole,
  type GuardrailTrace,
} from './guardrail-triggered.ts';

const encoder = new EventEncoder();

// Only these of the agent's events reach the client or storage. Others,
// such as RAW and TOOL_CALL_RESULT, can carry the guardrail's trace or a
// tool's full result.
const RELAYED_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  EventType.RUN_STARTED,
  EventType.RUN_FINISHED,
  EventType.RUN_ERROR,
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
]);

type RelayedEvent = BaseEvent & { threadId?: string };

export interface RelayAgentEventStreamParameters {
  source: AsyncIterable<Uint8Array>;
  userThreadId: string;
  systemThreadId: string;
  runId: string;
  onRunFinished: (
    guardrailBlocked: BlockedRole | undefined,
  ) => Promise<BlockedMessage | undefined>;
  onRunFailed: () => Promise<void>;
  onEvent?: (event: RelayedEvent) => void;
}

export async function* relayAgentEventStream({
  source,
  userThreadId,
  systemThreadId,
  runId,
  onRunFinished,
  onRunFailed,
  onEvent,
}: RelayAgentEventStreamParameters): AsyncGenerator<string> {
  let isRunStarted = false;
  let isOutcomeReported = false;
  let lastGuardrailTrace: GuardrailTrace | undefined;
  let hasToolResult = false;
  let guardrailBlocked: BlockedRole | undefined;
  // middy resets the logger's appended keys before it streams the body, so
  // anything logged from here has to carry its own context.
  const logContext = { systemThreadId, userThreadId, runId };
  const textDecoder = new TextDecoder('utf-8');
  const parsedEvents: RelayedEvent[] = [];
  const parser = createParser({
    onEvent: (message: EventSourceMessage) => {
      const event = JSON.parse(message.data) as RelayedEvent;
      lastGuardrailTrace = guardrailTraceIn(event) ?? lastGuardrailTrace;
      hasToolResult ||= event.type === EventType.TOOL_CALL_RESULT;
      if (isStoppedByGuardrail(event)) {
        // Once a tool has returned, the guardrail checks its result as the
        // latest message, so a block on the input after that isn't the
        // user's message. Without a trace, it's treated as a blocked answer,
        // so the streamed answer is never kept.
        guardrailBlocked =
          !hasToolResult &&
          lastGuardrailTrace &&
          isUserMessageBlocked(lastGuardrailTrace)
            ? 'user'
            : 'assistant';
      }
      if (RELAYED_EVENT_TYPES.has(event.type)) {
        parsedEvents.push(event);
      }
    },
  });

  const errorEvent: RunErrorEvent = {
    type: EventType.RUN_ERROR,
    message: 'Agent invocation error',
  };

  async function releaseThread(): Promise<void> {
    isOutcomeReported = true;
    try {
      await onRunFailed();
    } catch (error) {
      logger.error('Releasing the thread after a failed run failed', {
        error,
        ...logContext,
      });
    }
  }

  // The 200 has already gone by the time this runs, so middy can't turn an
  // error into a response. All streaming code should follow this approach:
  // catch its own errors, report them as a RUN_ERROR and clean up (here,
  // releasing the thread) itself, rather than rethrow.
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
        if (event.type === EventType.RUN_FINISHED) {
          const blockedMessage = await onRunFinished(guardrailBlocked);
          isOutcomeReported = true;
          if (blockedMessage) {
            yield encoder.encodeSSE(guardrailTriggeredEvent(blockedMessage));
          }
        }
        if (event.type === EventType.RUN_ERROR) {
          await releaseThread();
        }
        onEvent?.(event);
        yield encoder.encodeSSE(event);
      }
    }
  } catch (error) {
    logger.error('Agent event stream relay failed', { error, ...logContext });

    await releaseThread();

    if (!isRunStarted) {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: userThreadId,
        runId,
      };
      yield encoder.encodeSSE(startEvent);
    }

    yield encoder.encodeSSE(errorEvent);
  } finally {
    if (!isOutcomeReported) {
      await releaseThread();
    }
  }
}
