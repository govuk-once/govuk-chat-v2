import { describe, expect, it } from 'vitest';
import { EventType } from '@ag-ui/core';
import { MessageAccumulator } from './message-accumulator.ts';

describe('MessageAccumulator', () => {
  it('joins content deltas into a single string', () => {
    const accumulator = new MessageAccumulator();

    accumulator.process({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-1',
      delta: 'Hello ',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-1',
      delta: 'world',
    });

    expect(accumulator.getContent()).toBe('Hello world');
  });

  it('returns an empty string when no content events are received', () => {
    const accumulator = new MessageAccumulator();

    accumulator.process({
      type: EventType.RUN_STARTED,
      threadId: 'thread-1',
      runId: 'run-1',
    });

    expect(accumulator.getContent()).toBe('');
  });

  it('separates distinct messages with a double newline', () => {
    const accumulator = new MessageAccumulator();

    accumulator.process({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'msg-1',
      role: 'assistant',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-1',
      delta: 'First',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'msg-1',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'msg-2',
      role: 'assistant',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'msg-2',
      delta: 'Second',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'msg-2',
    });

    expect(accumulator.getContent()).toBe('First\n\nSecond');
  });
});
