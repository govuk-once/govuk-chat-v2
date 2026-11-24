import { createContext, use } from 'react';

// assistant-ui doesn't expose the AG-UI thread id in its state, so the chat
// provides it to the components that call routes for the thread.
export const ThreadIdContext = createContext<string | undefined>(undefined);

export function useThreadId(): string {
  const threadId = use(ThreadIdContext);
  if (!threadId) {
    throw new Error('useThreadId must be used inside a ThreadIdContext');
  }
  return threadId;
}
