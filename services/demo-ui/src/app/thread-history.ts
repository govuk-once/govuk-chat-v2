import {
  ExportedMessageRepository,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react';
import { fromAgUiMessages } from '@assistant-ui/react-ag-ui';

interface MessagesBody {
  messages: unknown[];
}

export const threadHistory: ThreadHistoryAdapter = {
  async load() {
    const response = await fetch('/api/chat/messages');
    if (!response.ok) {
      throw new Error(`Messages request failed with status ${response.status}`);
    }

    const { messages } = (await response.json()) as MessagesBody;
    return ExportedMessageRepository.fromArray(fromAgUiMessages(messages));
  },
  // The Chat API stores each message itself when a run finishes.
  async append() {},
};
