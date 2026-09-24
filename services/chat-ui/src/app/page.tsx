'use client';

import { HttpAgent } from '@ag-ui/client';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAgUiRuntime } from '@assistant-ui/react-ag-ui';
import { useState } from 'react';
import { Thread } from './thread.tsx';

function createAgent(): HttpAgent {
  return new HttpAgent({
    url: '/api/chat',
    threadId: crypto.randomUUID(),
    headers: { 'end-user-id': crypto.randomUUID() },
  });
}

export default function Home() {
  const [agent] = useState(createAgent);
  const runtime = useAgUiRuntime({ agent });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
