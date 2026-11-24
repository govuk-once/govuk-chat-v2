import { useAui, useAuiState } from '@assistant-ui/react';
import { useState } from 'react';
import type { Reaction } from '#chat-api/client.ts';
import { sendFeedback, type FeedbackOutcome } from './send-feedback.ts';
import { useThreadId } from './thread-id.ts';

const REACTIONS: Record<
  Reaction,
  { emoji: string; label: string; givenLabel: string }
> = {
  positive: {
    emoji: '👍',
    label: 'Helpful',
    givenLabel: 'You said this answer was helpful',
  },
  negative: {
    emoji: '👎',
    label: 'Not helpful',
    givenLabel: 'You said this answer was not helpful',
  },
};

const ERROR_MESSAGES: Record<Exclude<FeedbackOutcome, 'recorded'>, string> = {
  'already-given': 'Feedback has already been given on this answer.',
  failed: 'Your feedback could not be sent. Try again.',
};

// Shows the end user's reaction once the Chat API has stored it, rather than
// relying on assistant-ui's feedback adapter, which marks feedback as given
// without waiting to hear whether it was stored.
export function Feedback() {
  const aui = useAui();
  const threadId = useThreadId();
  const messageId = useAuiState((state) => state.message.id);
  const submitted = useAuiState(
    (state) => state.message.metadata.submittedFeedback,
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();

  if (submitted) {
    const { emoji, givenLabel } = REACTIONS[submitted.type];
    return (
      <p className="message-feedback">
        <span
          className="message-feedback-reaction message-feedback-given"
          role="img"
          aria-label={givenLabel}
        >
          {emoji}
        </span>
      </p>
    );
  }

  async function give(reaction: Reaction): Promise<void> {
    setIsSending(true);
    setError(undefined);
    const outcome = await sendFeedback({ threadId, messageId, reaction });
    setIsSending(false);

    if (outcome === 'recorded') {
      aui.message.submitFeedback({ type: reaction });
    } else {
      setError(ERROR_MESSAGES[outcome]);
    }
  }

  return (
    <div className="message-feedback">
      {(Object.keys(REACTIONS) as Reaction[]).map((reaction) => (
        <button
          key={reaction}
          type="button"
          className="message-feedback-reaction message-feedback-button"
          aria-label={REACTIONS[reaction].label}
          disabled={isSending}
          onClick={() => void give(reaction)}
        >
          {REACTIONS[reaction].emoji}
        </button>
      ))}
      {error && (
        <p className="message-feedback-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
