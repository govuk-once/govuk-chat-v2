import { NextResponse, type NextRequest } from 'next/server';
import { readSession } from '../../../../auth/session.ts';
import {
  listThreadTurns,
  type ThreadTurn,
} from '../../../../chat-api/client.ts';
import { endUserIdFor } from '../../../../chat-api/end-user-id.ts';
import { readThreadId, setThreadId } from '../cookies.ts';

interface ThreadTurnsBody {
  turns: ThreadTurn[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readSession(request.cookies);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const threadId = readThreadId(request.cookies);
  if (!threadId) {
    return NextResponse.json({ messages: [] });
  }

  const upstream = await listThreadTurns({
    threadId,
    endUserId: endUserIdFor(session.sub),
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

  const { turns } = (await upstream.json()) as ThreadTurnsBody;
  const response = NextResponse.json(
    { messages: turns.flatMap((turn) => turn.messages) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  setThreadId(response, threadId);
  return response;
}
