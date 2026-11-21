import type { Reaction } from '../chat-api/client.ts';

export type FeedbackOutcome = 'recorded' | 'already-given' | 'failed';

export async function sendFeedback(
  messageId: string,
  reaction: Reaction,
): Promise<FeedbackOutcome> {
  try {
    const response = await fetch(`/api/chat/messages/${messageId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction }),
    });
    if (response.ok) {
      return 'recorded';
    }
    return response.status === 409 ? 'already-given' : 'failed';
  } catch {
    return 'failed';
  }
}
