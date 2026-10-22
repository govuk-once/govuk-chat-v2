import { cookies } from 'next/headers';
import { readThreadId } from './api/chat/cookies.ts';
import { Chat } from './chat.tsx';

export default async function Home() {
  // The thread cookie is only set once a message has been sent, and "New
  // conversation" clears it, so without one there is no history to load.
  const savedThreadId = readThreadId(await cookies());

  return (
    <Chat
      threadId={savedThreadId ?? crypto.randomUUID()}
      isNewConversation={savedThreadId === undefined}
    />
  );
}
