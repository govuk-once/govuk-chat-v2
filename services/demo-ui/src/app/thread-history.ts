import {
  ExportedMessageRepository,
  type ThreadHistoryAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { fromAgUiMessages } from '@assistant-ui/react-ag-ui';
import type { Reaction, ThreadMessage } from '#chat-api/client.ts';

interface MessagesBody {
  messages: ThreadMessage[];
}

function withSubmittedFeedback(
  message: ThreadMessageLike,
  reactions: ReadonlyMap<string, Reaction>,
): ThreadMessageLike {
  const reaction = message.id && reactions.get(message.id);
  if (!reaction) {
    return message;
  }
  return {
    ...message,
    metadata: { ...message.metadata, submittedFeedback: { type: reaction } },
  };
}

export const threadHistory: ThreadHistoryAdapter = {
  async load() {
    const response = await fetch('/api/chat/messages');
    if (!response.ok) {
      throw new Error(`Messages request failed with status ${response.status}`);
    }

    const { messages } = (await response.json()) as MessagesBody;
    const reactions = new Map(
      messages.flatMap(({ id, feedback }) =>
        feedback ? [[id, feedback.reaction] as const] : [],
      ),
    );
    return ExportedMessageRepository.fromArray(
      fromAgUiMessages(messages).map((message) =>
        withSubmittedFeedback(message, reactions),
      ),
    );
  },
  // The Chat API stores each message itself when a run finishes.
  async append() {},
};
