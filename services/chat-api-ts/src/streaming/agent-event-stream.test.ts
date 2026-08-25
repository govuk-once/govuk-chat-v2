import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import {
  encoder,
  aguiEventStream,
  createFailingStream,
  createResponseStream,
} from '../test-utils/agent-stream.ts';
import { logger } from '../logging/logger.ts';
import { relayAgentEventStream } from './agent-event-stream.ts';

const THREAD_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();

describe('relayAgentEventStream', () => {
  it('relays a well-formed event stream unchanged and ends the destination', async () => {
    const events = [
      { type: EventType.RUN_STARTED, threadId: THREAD_ID, runId: RUN_ID },
      { type: EventType.RUN_FINISHED, threadId: THREAD_ID, runId: RUN_ID },
    ];
    const destination = createResponseStream();

    await relayAgentEventStream({
      source: aguiEventStream(events),
      destination,
      threadId: THREAD_ID,
      runId: RUN_ID,
    });

    expect(destination.read()).toBe(
      events.map((event) => encoder.encode(event)).join(''),
    );
    expect(destination.end).toHaveBeenCalledOnce();
  });

  it('emits synthetic RUN_STARTED followed by RUN_ERROR when the source fails before RUN_STARTED', async () => {
    const logError = vi.spyOn(logger, 'error');
    const destination = createResponseStream();

    await relayAgentEventStream({
      source: createFailingStream(),
      destination,
      threadId: THREAD_ID,
      runId: RUN_ID,
    });

    const expectedStartEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: THREAD_ID,
      runId: RUN_ID,
    };
    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(destination.read()).toBe(
      encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
    );
    expect(destination.end).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith('Agent event stream relay failed', {
      error: new Error('Stream failure'),
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
  });

  it('does not duplicate RUN_STARTED when the source fails after RUN_STARTED was already relayed', async () => {
    const logError = vi.spyOn(logger, 'error');
    const runStartedEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: THREAD_ID,
      runId: RUN_ID,
    };
    const destination = createResponseStream();

    await relayAgentEventStream({
      source: createFailingStream([encoder.encode(runStartedEvent)]),
      destination,
      threadId: THREAD_ID,
      runId: RUN_ID,
    });

    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(destination.read()).toBe(
      encoder.encode(runStartedEvent) + encoder.encode(expectedErrorEvent),
    );
    expect(destination.end).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith('Agent event stream relay failed', {
      error: new Error('Stream failure'),
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
  });
});
