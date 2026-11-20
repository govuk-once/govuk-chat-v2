import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  ThreadTurnsPathParametersSchema,
  ThreadTurnsQuerySchema,
  type ClientInputHeaders,
  type ThreadTurnsPathParameters,
  type ThreadTurnsQuery,
} from '../../schemas/client-input.ts';
import {
  zodPathParametersValidator,
  zodQueryValidator,
  type ValidatedHeadersEvent,
  type ValidatedPathParametersEvent,
  type ValidatedQueryEvent,
} from '../../http/zod-validator.ts';
import {
  buildJsonErrorResponse,
  type JsonErrorResponse,
} from '../../http/errors.ts';
import { endUserRequestHandler } from '../../http/end-user-request-handler.ts';
import { logger } from '../../logging/logger.ts';
import { lookupThread } from '../../persistence/messages.ts';
import { getTurnPage, type StoredTurn } from '../../persistence/turns.ts';
import type { TurnCursor } from '../../schemas/turn-cursor.ts';

const TURNS_ERROR = 'Turns retrieval error';

type ListTurnsEvent = ValidatedHeadersEvent<ClientInputHeaders> &
  ValidatedPathParametersEvent<ThreadTurnsPathParameters> &
  ValidatedQueryEvent<ThreadTurnsQuery>;

function turnsPageUrl(threadId: string, cursor: TurnCursor): string {
  return `/v1/threads/${threadId}/turns?cursor=${cursor.toString()}`;
}

function feedbackUrl(threadId: string, turnId: string): string {
  return `/v1/threads/${threadId}/turns/${turnId}/feedback`;
}

function feedbackFields(threadId: string, turn: StoredTurn) {
  if (turn.sender !== 'assistant') {
    return {};
  }
  return turn.feedback
    ? { feedback: turn.feedback }
    : { feedbackUrl: feedbackUrl(threadId, turn.turnId) };
}

function toResponseTurn(threadId: string, turn: StoredTurn) {
  return {
    id: turn.turnId,
    sender: turn.sender,
    createdAt: turn.createdAt,
    messages: turn.messages,
    ...feedbackFields(threadId, turn),
  };
}

async function listTurns(
  event: ListTurnsEvent,
): Promise<APIGatewayProxyResult | JsonErrorResponse> {
  const endUserId = event.headers['end-user-id'];
  const { threadId } = event.pathParameters;
  const { cursor } = event.queryStringParameters;
  logger.appendKeys({ userThreadId: threadId });

  const thread = await lookupThread({ endUserId, userThreadId: threadId });
  if (!thread) {
    return buildJsonErrorResponse(404, { error: 'Thread not found' });
  }
  logger.appendKeys({ systemThreadId: thread.systemThreadId });

  const page = await getTurnPage(thread.systemThreadId, cursor);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      turns: page.turns.map((turn) => toResponseTurn(threadId, turn)),
      earlierTurnsUrl: page.earlier && turnsPageUrl(threadId, page.earlier),
      laterTurnsUrl: page.later && turnsPageUrl(threadId, page.later),
    }),
  };
}

export const handler = endUserRequestHandler({
  errorMessage: TURNS_ERROR,
  middleware: (stack) =>
    stack
      .use(
        zodPathParametersValidator(
          ThreadTurnsPathParametersSchema,
          TURNS_ERROR,
        ),
      )
      .use(zodQueryValidator(ThreadTurnsQuerySchema, TURNS_ERROR)),
  handler: listTurns,
});
