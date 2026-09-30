import { cookies } from 'next/headers';
import { readThreadId } from './api/chat/cookies.ts';
import { Chat } from './chat.tsx';

export default async function Home() {
  const threadId = readThreadId(await cookies()) ?? crypto.randomUUID();

  return <Chat threadId={threadId} />;
}
