import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { MessageSchema, RunAgentInputSchema } from './schemas.ts';

const VALID_THREAD_ID = crypto.randomUUID();
const VALID_RUN_ID = crypto.randomUUID();

const VALID_MESSAGE = {
  id: 'msg-1',
  role: 'user',
  content: 'Tell me about SSP',
};

function issuePaths(result: z.ZodSafeParseResult<unknown>): string[] {
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  return result.error.issues.map((issue) => issue.path.join('.'));
}

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
    expect(result.success).toBe(false);
  });

  it('rejects an empty id', () => {
    const result = MessageSchema.safeParse({ ...VALID_MESSAGE, id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = MessageSchema.safeParse({ ...VALID_MESSAGE, content: '' });
    expect(issuePaths(result)).toContain('content');
  });

  it('rejects a message missing content entirely', () => {
    const { content: _content, ...withoutContent } = VALID_MESSAGE;
    const result = MessageSchema.safeParse(withoutContent);
    expect(result.success).toBe(false);
  });
});

describe('RunAgentInputSchema', () => {
  const validInput = {
    threadId: VALID_THREAD_ID,
    messages: [VALID_MESSAGE],
  };

  it('accepts a minimal valid input', () => {
    const result = RunAgentInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts a full valid input with all optional fields present but empty', () => {
    const result = RunAgentInputSchema.safeParse({
      ...validInput,
      runId: VALID_RUN_ID,
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
      expect(issuePaths(result)).toContain('threadId');
    });

    it('rejects a threadId that is not a UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        threadId: 'not-a-uuid',
      });
      if (result.success) throw new Error('expected validation to fail');
      expect(result.error.issues[0]).toMatchObject({
        path: ['threadId'],
        message: 'threadId must be a valid UUID',
      });
    });
  });

  describe('runId', () => {
    it('is optional', () => {
      const result = RunAgentInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('rejects a runId that is not a UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        runId: 'not-a-uuid',
      });
      if (result.success) throw new Error('expected validation to fail');
      expect(result.error.issues[0]).toMatchObject({
        path: ['runId'],
        message: 'runId must be a valid UUID',
      });
    });
  });

  describe('parentRunId', () => {
    it('rejects any value, including a valid UUID', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        parentRunId: VALID_RUN_ID,
      });
      expect(issuePaths(result)).toContain('parentRunId');
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
        state: { key: 'value' },
      });
      expect(issuePaths(result)).toContain('state');
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
      expect(issuePaths(result)).toContain('forwardedProps');
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
      expect(issuePaths(result)).toContain('tools');
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
        context: [{ description: 'actorId', value: 'user-1' }],
      });
      expect(issuePaths(result)).toContain('context');
    });
  });

  describe('messages', () => {
    it('rejects a missing messages field', () => {
      const { messages: _messages, ...withoutMessages } = validInput;
      const result = RunAgentInputSchema.safeParse(withoutMessages);
      expect(issuePaths(result)).toContain('messages');
    });

    it('rejects an empty messages array', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [],
      });
      if (result.success) throw new Error('expected validation to fail');
      expect(result.error.issues[0]).toMatchObject({
        path: ['messages'],
        message: 'messages must contain at least one message',
      });
    });

    it('accepts multiple messages provided the last one is from the user', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [
          { id: 'msg-0', role: 'assistant', content: 'How can I help?' },
          VALID_MESSAGE,
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects messages when the last one is not from the user', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [{ id: 'msg-1', role: 'assistant', content: 'hi' }],
      });
      if (result.success) throw new Error('expected validation to fail');
      expect(result.error.issues.at(-1)).toMatchObject({
        path: ['messages'],
        message: 'the last message must be a user message',
      });
    });

    it('surfaces per-message validation issues at their indexed path', () => {
      const result = RunAgentInputSchema.safeParse({
        ...validInput,
        messages: [{ id: 'msg-1', role: 'user', content: '' }],
      });
      expect(issuePaths(result)).toContain('messages.0.content');
    });
  });
});
