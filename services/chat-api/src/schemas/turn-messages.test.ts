import { describe, expect, it } from 'vitest';
import {
  AssistantTurnMessagesSchema,
  UserTurnMessagesSchema,
} from './turn-messages.ts';

const USER_MESSAGE = {
  id: 'b0000000-0000-4000-8000-000000000001',
  role: 'user',
  content: 'How do I renew my passport?',
};

const ASSISTANT_MESSAGE = {
  id: 'c0000000-0000-4000-8000-000000000001',
  role: 'assistant',
  content: 'You can renew your passport online on GOV.UK.',
};

describe('UserTurnMessagesSchema', () => {
  it('accepts one user message', () => {
    expect(UserTurnMessagesSchema.safeParse([USER_MESSAGE]).success).toBe(true);
  });

  it.each([
    ['an assistant message', [ASSISTANT_MESSAGE]],
    ['two user messages', [USER_MESSAGE, USER_MESSAGE]],
    ['a field the type does not have', [{ ...USER_MESSAGE, createdAt: 'x' }]],
  ])('rejects %s', (_, messages) => {
    expect(UserTurnMessagesSchema.safeParse(messages).success).toBe(false);
  });
});

describe('AssistantTurnMessagesSchema', () => {
  it('accepts assistant messages', () => {
    expect(
      AssistantTurnMessagesSchema.safeParse([
        ASSISTANT_MESSAGE,
        { ...ASSISTANT_MESSAGE, id: 'c0000000-0000-4000-8000-000000000002' },
      ]).success,
    ).toBe(true);
  });

  it.each([
    ['a user message', [USER_MESSAGE]],
    [
      'a field the type does not have',
      [{ ...ASSISTANT_MESSAGE, createdAt: 'x' }],
    ],
  ])('rejects %s', (_, messages) => {
    expect(AssistantTurnMessagesSchema.safeParse(messages).success).toBe(false);
  });
});
