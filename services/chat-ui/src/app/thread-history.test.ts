import { beforeEach, describe, expect, it, vi } from 'vitest';
import { threadHistory } from './thread-history.ts';

const MESSAGES = [
  {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Tell me about SSP',
    createdAt: '2026-09-30T12:00:00.000Z',
  },
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'SSP is...',
    createdAt: '2026-09-30T12:00:05.000Z',
  },
];

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

describe('load', () => {
  it('loads the messages from the messages route in order', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ messages: MESSAGES }));

    const repo = await threadHistory.load();

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages');
    expect(repo.messages.map(({ message }) => message.id)).toEqual(
      MESSAGES.map(({ id }) => id),
    );
  });

  it('throws when the messages route fails', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Chat API request failed' }, { status: 500 }),
    );

    await expect(threadHistory.load()).rejects.toThrow(
      'Messages request failed with status 500',
    );
  });
});
