import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MessageSchema,
  RunAgentInputSchema,
  ClientInputHeadersSchema,
} from './client-input.ts';

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_RUN_ID = crypto.randomUUID();

const VALID_MESSAGE = {
  id: crypto.randomUUID(),
  role: 'user',
  content: 'Tell me about SSP',
};

describe('ClientInputHeadersSchema', () => {
  it('accepts valid headers containing end-user-id', () => {
    const result = ClientInputHeadersSchema.safeParse({
      'end-user-id': 'user-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing end-user-id header', () => {
    const result = ClientInputHeadersSchema.safeParse({});
    const error = z.flattenError(result.error!);

    expect(result.success).toBe(false);
    expect(error.fieldErrors).toEqual({
      'end-user-id': ['end-user-id header is required'],
    });
  });
});

describe('MessageSchema', () => {
  it('accepts a valid message', () => {
    const result = MessageSchema.safeParse(VALID_MESSAGE);
    expect(result.success).toBe(true);
  });

  it('accepts each allowed role', () => {
    for (const role of ['user', 'assistant', 'system', 'tool']) {
      const result = MessageSchema.safeParse({ ...VALID_MESSAGE, role });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a role outside the allowed set', () => {
    const result = MessageSchema.safeParse({
      ...VALID_MESSAGE,
      role: 'developer',
    });
    const error = z.flattenError(result.error!);

    expect(result.success).toBe(false);
    expect(error.fieldErrors).toMatchObject({ role: [/Invalid option/] });
  });

  it('rejects an empty id', () => {
    const { id: _id, ...withoutId } = VALID_MESSAGE;
    const result = MessageSchema.safeParse(withoutId);
    const error = z.flattenError(result.error!);

    expect(result.success).toBe(false);
    expect(error.fieldErrors).toEqual({
      id: ['id must be a valid UUID'],
    });
  });

  it('rejects empty content', () => {
    const result = MessageSchema.safeParse({ ...VALID_MESSAGE, content: '' });
    const error = z.flattenError(result.error!);

    expect(result.success).toBe(false);
    expect(error.fieldErrors).toEqual({
      content: ['content must not be empty'],
    });
  });

  it('rejects a message missing content entirely', () => {
    const { content: _content, ...withoutContent } = VALID_MESSAGE;
    const result = MessageSchema.safeParse(withoutContent);
    const error = z.flattenError(result.error!);

    expect(result.success).toBe(false);
    expect(error.fieldErrors).toEqual({
      content: ['Invalid input: expected string, received undefined'],
    });
  });
});

describe('RunAgentInputSchema', () => {
  const validInput = {
    threadId: VALID_THREAD_ID,
    runId: VALID_RUN_ID,
    messages: [VALID_MESSAGE],
  };

  it('accepts a minimal valid input', () => {
    const result = RunAgentInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts a full valid input with all optional fields present but empty', () => {
    const result = RunAgentInputSchema.safeParse({
      ...validInput,
      state: {},
      forwardedProps: {},
      tools: [],
      context: [],
    });
    expect(result.success).toBe(true);
  });

  describe('threadId', () => {
    it('rejects a missing threadId', () => {
      const { threadId: _threadId, ...withoutThreadId } = validInput;
      const result = RunAgentInputSchema.safeParse(withoutThreadId);
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        threadId: ['threadId must be a valid UUID'],
      });
    });

    it('rejects a threadId that is not a UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        threadId: 'not-a-uuid',
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        threadId: ['threadId must be a valid UUID'],
      });
    });
  });

  describe('runId', () => {
    it('rejects a runId that is not a UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        runId: 'not-a-uuid',
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        runId: ['runId must be a valid UUID'],
      });
    });
  });

  describe('parentRunId', () => {
    it('rejects any value, including a valid UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        parentRunId: VALID_RUN_ID,
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        parentRunId: ['Invalid input: expected never, received string'],
      });
    });
  });

  describe('state', () => {
    it('accepts an empty object', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        state: {},
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-empty object', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        state: { invalidKey: 'value' },
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        state: ['Unrecognized key: "invalidKey"'],
      });
    });
  });

  describe('forwardedProps', () => {
    it('accepts an empty object', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        forwardedProps: {},
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-empty object', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        forwardedProps: { foo: 'bar' },
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        forwardedProps: ['Unrecognized key: "foo"'],
      });
    });
  });

  describe('tools', () => {
    it('accepts an empty array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        tools: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-empty array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        tools: [{ name: 'search' }],
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        tools: ['Too big: expected array to have <=0 items'],
      });
    });
  });

  describe('context', () => {
    it('accepts an empty array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        context: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-empty array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        context: [{ description: 'context', value: 'toggle' }],
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        context: ['Too big: expected array to have <=0 items'],
      });
    });
  });

  describe('messages', () => {
    it('rejects a missing messages field', () => {
      const { messages: _messages, ...withoutMessages } = validInput;
      const result = RunAgentInputSchema.safeParse(withoutMessages);
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        messages: ['Invalid input: expected array, received undefined'],
      });
    });

    it('rejects an empty messages array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [],
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        messages: [
          'messages must contain at least one message',
          'the last message must be a user message',
        ],
      });
    });

    it('accepts multiple messages provided the last one is from the user', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'How can I help?',
          },
          VALID_MESSAGE,
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects messages when the last one is not from the user', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [
          { id: crypto.randomUUID(), role: 'assistant', content: 'hi' },
        ],
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toEqual({
        messages: ['the last message must be a user message'],
      });
    });

    it('rejects a message with empty content', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [{ id: crypto.randomUUID(), role: 'user', content: '' }],
      });
      const error = z.flattenError(result.error!);

      expect(result.success).toBe(false);
      expect(error.fieldErrors).toHaveProperty('messages');
      expect(error.fieldErrors.messages).toEqual(['content must not be empty']);
    });
  });
});
