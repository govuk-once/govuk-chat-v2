import { RunAgentInputSchema } from '@ag-ui/core';
import { z } from 'zod';
import { invokeThread } from '../../../chat-api/client.ts';

export const runtime = 'nodejs';

const uuidSchema = z.uuid();

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  const endUserId = uuidSchema.safeParse(request.headers.get('end-user-id'));
  if (!endUserId.success) {
    return errorResponse(422, 'Invalid request headers');
  }

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

  // assistant-ui's ids and fields fail the API's strict schema, so the route
  // builds the request rather than forwarding the body. Only the last message
  // is sent, because the API stores only that and the agent keeps its own
  // memory of the thread.
  const upstream = await invokeThread({
    threadId: body.data.threadId,
    runId: crypto.randomUUID(),
    endUserId: endUserId.data,
    content: lastMessage.content,
    signal: request.signal,
  });

  if (!upstream.ok) {
    await upstream.body?.cancel();
    return errorResponse(upstream.status, 'Chat API request failed');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
}
