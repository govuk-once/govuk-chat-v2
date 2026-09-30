import { NextResponse, type NextRequest } from 'next/server';
import {
  listThreadMessages,
  type ThreadMessage,
} from '../../../../chat-api/client.ts';
import {
  readEndUserId,
  readThreadId,
  setEndUserId,
  setThreadId,
} from '../cookies.ts';

export const runtime = 'nodejs';

interface ThreadMessagesBody {
  messages: ThreadMessage[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const threadId = readThreadId(request.cookies);
  const endUserId = readEndUserId(request.cookies);
  if (!threadId || !endUserId) {
    return NextResponse.json({ messages: [] });
  }

  const upstream = await listThreadMessages({
    threadId,
    endUserId,
    signal: request.signal,
  });

  if (upstream.status === 404) {
    await upstream.body?.cancel();
    return NextResponse.json({ messages: [] });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return NextResponse.json(
      { error: 'Chat API request failed' },
      { status: upstream.status },
    );
  }

  const { messages } = (await upstream.json()) as ThreadMessagesBody;
  const response = NextResponse.json(
    { messages },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  setThreadId(response, threadId);
  setEndUserId(response, endUserId);
  return response;
}
