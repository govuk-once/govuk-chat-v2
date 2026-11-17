import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readSession } from '../../../../../../../../auth/session.ts';
import { giveFeedback } from '../../../../../../../../chat-api/client.ts';
import { endUserIdFor } from '../../../../../../../../chat-api/end-user-id.ts';
import { readJson } from '../../../../../../../../lib/read-json.ts';

const parametersSchema = z.object({
  'thread-id': z.uuid(),
  'message-id': z.uuid(),
});
const feedbackBodySchema = z
  .object({ reaction: z.enum(['positive', 'negative']) })
  .strict();

interface FeedbackRouteContext {
  params: Promise<{ 'thread-id': string; 'message-id': string }>;
}

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: FeedbackRouteContext,
): Promise<NextResponse> {
  const session = await readSession(request.cookies);
  if (!session) {
    return errorResponse(401, 'Not authenticated');
  }

  const ids = parametersSchema.safeParse(await params);
  const body = feedbackBodySchema.safeParse(await readJson(request));
  if (!ids.success || !body.success) {
    return errorResponse(422, 'Invalid request');
  }

  const upstream = await giveFeedback({
    threadId: ids.data['thread-id'],
    messageId: ids.data['message-id'],
    endUserId: endUserIdFor(session.sub),
    reaction: body.data.reaction,
    signal: request.signal,
  });
  await upstream.body?.cancel();

  return upstream.ok
    ? NextResponse.json({}, { status: 201 })
    : errorResponse(upstream.status, 'Chat API request failed');
}
