import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readSession } from '../../../../../../auth/session.ts';
import { giveFeedback } from '../../../../../../chat-api/client.ts';
import { endUserIdFor } from '../../../../../../chat-api/end-user-id.ts';
import { readJson } from '../../../../../../lib/read-json.ts';
import { readThreadId } from '../../../cookies.ts';

const uuidSchema = z.uuid();
const feedbackBodySchema = z
  .object({ reaction: z.enum(['positive', 'negative']) })
  .strict();

interface FeedbackRouteContext {
  params: Promise<{ 'message-id': string }>;
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

  const threadId = readThreadId(request.cookies);
  if (!threadId) {
    return errorResponse(404, 'Message not found');
  }

  const { 'message-id': messageId } = await params;
  const body = feedbackBodySchema.safeParse(await readJson(request));
  if (!uuidSchema.safeParse(messageId).success || !body.success) {
    return errorResponse(422, 'Invalid request');
  }

  const upstream = await giveFeedback({
    threadId,
    messageId,
    endUserId: endUserIdFor(session.sub),
    reaction: body.data.reaction,
    signal: request.signal,
  });
  await upstream.body?.cancel();

  return upstream.ok
    ? NextResponse.json({}, { status: 201 })
    : errorResponse(upstream.status, 'Chat API request failed');
}
