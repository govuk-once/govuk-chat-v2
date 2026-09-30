import { RunAgentInputSchema } from '@ag-ui/core';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { invokeThread } from '../../../chat-api/client.ts';
import { readEndUserId, setEndUserId, setThreadId } from './cookies.ts';

export const runtime = 'nodejs';

const uuidSchema = z.uuid();

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = RunAgentInputSchema.safeParse(await readJson(request));
  if (!body.success || !uuidSchema.safeParse(body.data.threadId).success) {
    return errorResponse(422, 'Invalid request body');
  }

  const lastMessage = body.data.messages.at(-1);
  if (
    lastMessage?.role !== 'user' ||
    typeof lastMessage.content !== 'string' ||
    lastMessage.content === ''
  ) {
    return errorResponse(422, 'Invalid request body');
  }

  const { threadId } = body.data;
  const endUserId = readEndUserId(request.cookies) ?? crypto.randomUUID();

  // assistant-ui's ids and fields fail the API's strict schema, so the route
  // builds the request rather than forwarding the body. Only the last message
  // is sent, because the API stores only that and the agent keeps its own
  // memory of the thread.
  const upstream = await invokeThread({
    threadId,
    runId: crypto.randomUUID(),
    endUserId,
    content: lastMessage.content,
    signal: request.signal,
  });

  if (!upstream.ok) {
    await upstream.body?.cancel();
    return errorResponse(upstream.status, 'Chat API request failed');
  }

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
  setThreadId(response, threadId);
  setEndUserId(response, endUserId);
  return response;
}
