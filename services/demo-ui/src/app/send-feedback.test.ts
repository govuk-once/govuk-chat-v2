import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFeedback } from './send-feedback.ts';

const INPUT = {
  threadId: crypto.randomUUID(),
  messageId: crypto.randomUUID(),
  reaction: 'positive' as const,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

describe('sendFeedback', () => {
  it('posts the reaction to the feedback route and reports it recorded', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 201 }));

    expect(await sendFeedback(INPUT)).toBe('recorded');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/chat/threads/${INPUT.threadId}/messages/${INPUT.messageId}/feedback`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reaction: 'positive' }),
      }),
    );
  });

  it('reports feedback already given when the route returns 409', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 409 }));

    expect(await sendFeedback(INPUT)).toBe('already-given');
  });

  it('reports a failure when the route returns another error', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }));

    expect(await sendFeedback(INPUT)).toBe('failed');
  });

  it('reports a failure when the request does not complete', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await sendFeedback(INPUT)).toBe('failed');
  });
});
