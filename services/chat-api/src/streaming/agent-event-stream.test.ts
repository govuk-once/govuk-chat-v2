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
import type { BlockedMessage } from './guardrail-triggered.ts';

const USER_THREAD_ID = crypto.randomUUID();
const SYSTEM_THREAD_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();

const onRunFinished =
  vi.fn<
    (wasGuardrailTriggered: boolean) => Promise<BlockedMessage | undefined>
  >();
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
  onRunFinished.mockResolvedValue(undefined);
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

  it('passes on only allowlisted event types, to the client and to onEvent', async () => {
    const textContent: BaseEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-1',
      delta: 'Hi',
    };
    const events: BaseEvent[] = [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'search_govuk_content',
      },
      textContent,
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: 'msg-2',
        toolCallId: 'tool-1',
        content: '[{"title":"Renew your passport"}]',
      },
      { type: EventType.RAW, event: { metrics: {} } },
    ];

    const onEvent = vi.fn();
    const sseStream = relayAgentEventStream({
      ...relayParameters(aguiEventStream(events)),
      onEvent,
    });

    expect(await collectStreamText(sseStream)).toBe(
      encoder.encode(textContent),
    );
    expect(onEvent.mock.calls.map((call) => call[0])).toEqual([textContent]);
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
      systemThreadId: SYSTEM_THREAD_ID,
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
      systemThreadId: SYSTEM_THREAD_ID,
      userThreadId: USER_THREAD_ID,
      runId: RUN_ID,
    });
  });

  it('records the run before relaying RUN_FINISHED', async () => {
    const relayed: string[] = [];
    onRunFinished.mockImplementation(async () => {
      relayed.push('recorded');
      return;
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

  it('records that the guardrail stepped in, without relaying AgentStopped', async () => {
    const answer: BaseEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-1',
      delta: 'A harmful answer',
    };
    const runFinished: BaseEvent = {
      type: EventType.RUN_FINISHED,
      threadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    };

    const sseStream = relayAgentEventStream(
      relayParameters(
        aguiEventStream([
          answer,
          {
            type: EventType.CUSTOM,
            name: 'AgentStopped',
            value: { stop_reason: 'guardrail_intervened' },
          } as BaseEvent,
          runFinished,
        ]),
      ),
    );

    expect(await collectStreamText(sseStream)).toBe(
      encoder.encode(answer) +
        encoder.encode({ ...runFinished, threadId: USER_THREAD_ID }),
    );
    expect(onRunFinished).toHaveBeenCalledWith(true);
  });

  it('tells the client the blocked message just before RUN_FINISHED', async () => {
    const blockedMessage = {
      messageIds: ['msg-1'],
      content: 'Output blocked',
    };
    onRunFinished.mockResolvedValueOnce(blockedMessage);
    const runFinished: BaseEvent = {
      type: EventType.RUN_FINISHED,
      threadId: SYSTEM_THREAD_ID,
      runId: RUN_ID,
    };

    const sseStream = relayAgentEventStream(
      relayParameters(aguiEventStream([runFinished])),
    );

    expect(await collectStreamText(sseStream)).toBe(
      encoder.encode({
        type: EventType.CUSTOM,
        name: 'guardrailTriggered',
        value: blockedMessage,
      } as BaseEvent) +
        encoder.encode({ ...runFinished, threadId: USER_THREAD_ID }),
    );
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
