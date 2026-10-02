'use client';

import { HttpAgent } from '@ag-ui/client';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAgUiRuntime } from '@assistant-ui/react-ag-ui';
import { useState } from 'react';
import { threadHistory } from './thread-history.ts';
import { Thread } from './thread.tsx';

function createAgent(threadId: string): HttpAgent {
  return new HttpAgent({ url: '/api/chat', threadId });
}

interface ChatProps {
  threadId: string;
  isNewConversation: boolean;
}

export function Chat({ threadId, isNewConversation }: ChatProps) {
  const [agent] = useState(() => createAgent(threadId));
  const runtime = useAgUiRuntime({
    agent,
    adapters: isNewConversation ? {} : { history: threadHistory },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread isNewConversation={isNewConversation} />
    </AssistantRuntimeProvider>
  );
}
