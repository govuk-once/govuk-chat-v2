import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  ThreadMessagesPathParametersSchema,
  ThreadMessagesQuerySchema,
  type ClientInputHeaders,
  type ThreadMessagesPathParameters,
  type ThreadMessagesQuery,
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
import {
  lookupThread,
  getMessagePage,
  type StoredMessage,
} from '../../persistence/messages.ts';
import type { Cursor } from '../../schemas/message-cursor.ts';

type ListMessagesEvent = ValidatedHeadersEvent<ClientInputHeaders> &
  ValidatedPathParametersEvent<ThreadMessagesPathParameters> &
  ValidatedQueryEvent<ThreadMessagesQuery>;

function messagesPageUrl(threadId: string, cursor: Cursor): string {
  return `/v1/threads/${threadId}/messages?cursor=${cursor.toString()}`;
}

function feedbackUrl(threadId: string, messageId: string): string {
  return `/v1/threads/${threadId}/messages/${messageId}/feedback`;
}

function feedbackFields(threadId: string, message: StoredMessage) {
  if (message.role !== 'assistant') {
    return {};
  }
  return message.feedback
    ? { feedback: message.feedback }
    : { feedbackUrl: feedbackUrl(threadId, message.messageId) };
}

async function listMessages(
  event: ListMessagesEvent,
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

  const page = await getMessagePage(thread.systemThreadId, cursor);

  const earlierMessagesUrl = page.earlier
    ? messagesPageUrl(threadId, page.earlier)
    : undefined;
  const laterMessagesUrl = page.later
    ? messagesPageUrl(threadId, page.later)
    : undefined;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: page.messages.map((message) => ({
        id: message.messageId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...feedbackFields(threadId, message),
      })),
      earlierMessagesUrl,
      laterMessagesUrl,
    }),
  };
}

export const handler = endUserRequestHandler({
  errorMessage: 'Messages retrieval error',
  addMiddlewares: (stack) =>
    stack
      .use(
        zodPathParametersValidator(
          ThreadMessagesPathParametersSchema,
          'Messages retrieval error',
        ),
      )
      .use(
        zodQueryValidator(
          ThreadMessagesQuerySchema,
          'Messages retrieval error',
        ),
      ),
  handler: listMessages,
});
