import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const onRunFinished = vi.fn<() => Promise<void>>();
const onRunFailed = vi.fn<() => Promise<void>>();

function eventsForThread(threadId: string): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId, runId: RUN_ID },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'msg-1', delta: 'Hi' },
    { type: EventType.RUN_FINISHED, threadId, runId: RUN_ID },
  ];
}

function relayParameters(source: AsyncIterable<Uint8Array>) {
  return {
    source,
    userThreadId: USER_THREAD_ID,
    systemThreadId: SYSTEM_THREAD_ID,
    runId: RUN_ID,
    onRunFinished,
    onRunFailed,
  };
}

beforeEach(() => {
  onRunFinished.mockResolvedValue();
  onRunFailed.mockResolvedValue();
});

describe('relayAgentEventStream', () => {
  it('relays the event stream with run events carrying the client thread id', async () => {
    const sseStream = relayAgentEventStream(
      relayParameters(aguiEventStream(eventsForThread(SYSTEM_THREAD_ID))),
    );

    expect(await collectStreamText(sseStream)).toBe(
      eventsForThread(USER_THREAD_ID)
        .map((event) => encoder.encode(event))
        .join(''),
    );
  });

  it('emits synthetic RUN_STARTED followed by RUN_ERROR when the source fails before RUN_STARTED', async () => {
    const logError = vi.spyOn(logger, 'error');
    const sseStream = relayAgentEventStream(
      relayParameters(createFailingStream()),
    );

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

    const sseStream = relayAgentEventStream(
      relayParameters(createFailingStream([encoder.encode(runStartedEvent)])),
    );

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

  it('records the run before relaying RUN_FINISHED', async () => {
    const relayed: string[] = [];
    onRunFinished.mockImplementation(async () => {
      relayed.push('recorded');
    });

    const sseStream = relayAgentEventStream(
      relayParameters(
        aguiEventStream([
          {
            type: EventType.RUN_STARTED,
            threadId: SYSTEM_THREAD_ID,
            runId: RUN_ID,
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: SYSTEM_THREAD_ID,
            runId: RUN_ID,
          },
        ]),
      ),
    );

    for await (const chunk of sseStream) {
      relayed.push(chunk.includes('RUN_FINISHED') ? 'finished' : 'other');
    }

    expect(relayed).toEqual(['other', 'recorded', 'finished']);
    expect(onRunFailed).not.toHaveBeenCalled();
  });

  it('ends the stream with RUN_ERROR when the finished run cannot be recorded', async () => {
    onRunFinished.mockRejectedValue(new Error('Run completion was cancelled'));

    const sseStream = relayAgentEventStream(
      relayParameters(
        aguiEventStream([
          {
            type: EventType.RUN_STARTED,
            threadId: SYSTEM_THREAD_ID,
            runId: RUN_ID,
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: SYSTEM_THREAD_ID,
            runId: RUN_ID,
          },
        ]),
      ),
    );

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
    expect(onRunFailed).toHaveBeenCalled();
  });

  it('releases the thread without recording when the agent reports a run error', async () => {
    const sseStream = relayAgentEventStream(
      relayParameters(
        aguiEventStream([
          { type: EventType.RUN_ERROR, message: 'Agent failed' } as BaseEvent,
        ]),
      ),
    );

    await collectStreamText(sseStream);

    expect(onRunFailed).toHaveBeenCalled();
    expect(onRunFinished).not.toHaveBeenCalled();
  });

  it('releases the thread when the stream ends without a run outcome', async () => {
    const sseStream = relayAgentEventStream(
      relayParameters(
        aguiEventStream([
          {
            type: EventType.RUN_STARTED,
            threadId: SYSTEM_THREAD_ID,
            runId: RUN_ID,
          },
        ]),
      ),
    );

    await collectStreamText(sseStream);

    expect(onRunFailed).toHaveBeenCalled();
    expect(onRunFinished).not.toHaveBeenCalled();
  });

  it('relays the stream even when releasing the thread fails', async () => {
    const logError = vi.spyOn(logger, 'error');
    onRunFailed.mockRejectedValue(new Error('Release failed'));

    const sseStream = relayAgentEventStream(
      relayParameters(createFailingStream()),
    );

    expect(await collectStreamText(sseStream)).toContain('RUN_ERROR');
    expect(logError).toHaveBeenCalledWith(
      'Releasing the thread after a failed run failed',
      expect.objectContaining({ error: new Error('Release failed') }),
    );
  });
});
