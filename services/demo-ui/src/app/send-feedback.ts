import type { Reaction } from '#chat-api/client.ts';

export type FeedbackOutcome = 'recorded' | 'already-given' | 'failed';

interface SendFeedbackInput {
  threadId: string;
  messageId: string;
  reaction: Reaction;
}

export async function sendFeedback({
  threadId,
  messageId,
  reaction,
}: SendFeedbackInput): Promise<FeedbackOutcome> {
  try {
    const response = await fetch(
      `/api/chat/threads/${threadId}/messages/${messageId}/feedback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction }),
      },
    );
    if (response.ok) {
      return 'recorded';
    }
    return response.status === 409 ? 'already-given' : 'failed';
  } catch {
    return 'failed';
  }
}
