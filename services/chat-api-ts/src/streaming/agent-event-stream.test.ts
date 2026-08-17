import { describe, expect, it } from 'vitest';
import {
  EventType,
  type RunErrorEvent,
  type RunStartedEvent,
} from '@ag-ui/core';
import {
  encoder,
  aguiEventStream,
  createFailingStream,
  writtenText,
} from '../test-utils/agent-stream.ts';
import { relayAgentEventStream } from './agent-event-stream.ts';

const THREAD_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();

describe('relayAgentEventStream', () => {
  it('relays a well-formed event stream unchanged', async () => {
    const events = [
      { type: EventType.RUN_STARTED, threadId: THREAD_ID, runId: RUN_ID },
      { type: EventType.RUN_FINISHED, threadId: THREAD_ID, runId: RUN_ID },
    ];

    const sseStream = relayAgentEventStream({
      source: aguiEventStream(events),
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const text = await writtenText(sseStream);

    expect(text).toBe(events.map((event) => encoder.encode(event)).join(''));
  });

  it('emits synthetic RUN_STARTED followed by RUN_ERROR when the source fails before RUN_STARTED', async () => {
    const sseStream = relayAgentEventStream({
      source: createFailingStream(),
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const text = await writtenText(sseStream);

    const expectedStartEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: THREAD_ID,
      runId: RUN_ID,
    };
    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(text).toBe(
      encoder.encode(expectedStartEvent) + encoder.encode(expectedErrorEvent),
    );
  });

  it('does not duplicate RUN_STARTED when the source fails after RUN_STARTED was already relayed', async () => {
    const runStartedEvent: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: THREAD_ID,
      runId: RUN_ID,
    };

    const sseStream = relayAgentEventStream({
      source: createFailingStream([encoder.encode(runStartedEvent)]),
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const text = await writtenText(sseStream);

    const expectedErrorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: 'Agent invocation error',
    };

    expect(text).toBe(
      encoder.encode(runStartedEvent) + encoder.encode(expectedErrorEvent),
    );
  });
});
