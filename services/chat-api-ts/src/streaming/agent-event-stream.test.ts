import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  type BaseEvent,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import {
  encoder,
  aguiEventStream,
  createFailingStream,
  collectStreamText,
} from '../test-utils/agent-stream.ts';
import { logger } from '../logging/logger.ts';
import { relayAgentEventStream } from './agent-event-stream.ts';

const USER_THREAD_ID = crypto.randomUUID();
const SYSTEM_THREAD_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();

describe('relayAgentEventStream', () => {
  it('relays the event stream with run events carrying the client thread id', async () => {
    const eventsForThread = (threadId: string): BaseEvent[] => [
      { type: EventType.RUN_STARTED, threadId, runId: RUN_ID },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'msg-1', delta: 'Hi' },
      { type: EventType.RUN_FINISHED, threadId, runId: RUN_ID },
    ];

    const sseStream = relayAgentEventStream({
      source: aguiEventStream(eventsForThread(SYSTEM_THREAD_ID)),
      userThreadId: USER_THREAD_ID,
      systemThreadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    });

    expect(await collectStreamText(sseStream)).toBe(
      eventsForThread(USER_THREAD_ID)
        .map((event) => encoder.encode(event))
        .join(''),
    );
  });

  it('emits synthetic RUN_STARTED followed by RUN_ERROR when the source fails before RUN_STARTED', async () => {
    const logError = vi.spyOn(logger, 'error');
    const sseStream = relayAgentEventStream({
      source: createFailingStream(),
      userThreadId: USER_THREAD_ID,
      systemThreadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    });

    const expectedStartEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: USER_THREAD_ID,
      runId: RUN_ID,
    };
    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(await collectStreamText(sseStream)).toBe(
      encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
    );
    expect(logError).toHaveBeenCalledWith('Agent event stream relay failed', {
      error: new Error('Stream failure'),
      threadId: SYSTEM_THREAD_ID,
      userThreadId: USER_THREAD_ID,
      runId: RUN_ID,
    });
  });

  it('does not duplicate RUN_STARTED when the source fails after RUN_STARTED was already relayed', async () => {
    const logError = vi.spyOn(logger, 'error');
    const runStartedEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    };

    const sseStream = relayAgentEventStream({
      source: createFailingStream([encoder.encode(runStartedEvent)]),
      userThreadId: USER_THREAD_ID,
      systemThreadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    });

    const expectedStartEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: USER_THREAD_ID,
      runId: RUN_ID,
    };
    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(await collectStreamText(sseStream)).toBe(
      encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
    );
    expect(logError).toHaveBeenCalledWith('Agent event stream relay failed', {
      error: new Error('Stream failure'),
      threadId: SYSTEM_THREAD_ID,
      userThreadId: USER_THREAD_ID,
      runId: RUN_ID,
    });
  });
});
