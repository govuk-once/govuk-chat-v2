import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps the id of the last message started', () => {
    const accumulator = new MessageAccumulator();

    accumulator.process({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'msg-1',
      role: 'assistant',
    });
    accumulator.process({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'msg-2',
      role: 'assistant',
    });

    expect(accumulator.getLastMessageId()).toBe('msg-2');
  });

  describe('getFirstOutputAt', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('is when the first text message started', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const accumulator = new MessageAccumulator();

      vi.setSystemTime(new Date('2026-11-09T10:00:01.000Z'));
      accumulator.process({
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-1',
        role: 'assistant',
      });
      vi.setSystemTime(new Date('2026-11-09T10:00:02.000Z'));
      accumulator.process({
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-2',
        role: 'assistant',
      });

      expect(accumulator.getFirstOutputAt()).toBe('2026-11-09T10:00:01.000Z');
    });

    it('is absent before a text message starts', () => {
      const accumulator = new MessageAccumulator();

      accumulator.process({
        type: EventType.RUN_STARTED,
        threadId: 'thread-1',
        runId: 'run-1',
      });

      expect(accumulator.getFirstOutputAt()).toBeUndefined();
    });
  });
});
