import httpJsonBodyParser from '@middy/http-json-body-parser';
import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  MessageFeedbackBodySchema,
  MessageFeedbackPathParametersSchema,
  type ClientInputHeaders,
  type MessageFeedbackBody,
  type MessageFeedbackPathParameters,
} from '../../schemas/client-input.ts';
import {
  zodBodyValidator,
  zodPathParametersValidator,
  type ValidatedBodyEvent,
  type ValidatedHeadersEvent,
  type ValidatedPathParametersEvent,
} from '../../http/zod-validator.ts';
import {
  buildJsonErrorResponse,
  type JsonErrorResponse,
} from '../../http/errors.ts';
import { endUserRequestHandler } from '../../http/end-user-request-handler.ts';
import { logger } from '../../logging/logger.ts';
import { lookupThread } from '../../persistence/messages.ts';
import {
  recordFeedback,
  type FeedbackOutcome,
} from '../../persistence/feedback.ts';

const FEEDBACK_ERROR = 'Feedback recording error';

const REJECTIONS: Record<
  Exclude<FeedbackOutcome['status'], 'recorded'>,
  { statusCode: number; error: string }
> = {
  'message-not-found': { statusCode: 404, error: 'Message not found' },
  'already-provided': {
    statusCode: 409,
    error: 'Feedback has already been given for this message',
  },
};

type GiveFeedbackEvent = ValidatedHeadersEvent<ClientInputHeaders> &
  ValidatedPathParametersEvent<MessageFeedbackPathParameters> &
  ValidatedBodyEvent<MessageFeedbackBody>;

async function giveFeedback(
  event: GiveFeedbackEvent,
): Promise<APIGatewayProxyResult | JsonErrorResponse> {
  const endUserId = event.headers['end-user-id'];
  const { threadId, messageId } = event.pathParameters;
  logger.appendKeys({ userThreadId: threadId, messageId });

  const thread = await lookupThread({ endUserId, userThreadId: threadId });
  if (!thread) {
    return buildJsonErrorResponse(404, { error: 'Thread not found' });
  }
  logger.appendKeys({ systemThreadId: thread.systemThreadId });

  const outcome = await recordFeedback(
    { systemThreadId: thread.systemThreadId, messageId },
    event.body.reaction,
  );

  if (outcome.status !== 'recorded') {
    const { statusCode, error } = REJECTIONS[outcome.status];
    return buildJsonErrorResponse(statusCode, { error });
  }

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  };
}

export const handler = endUserRequestHandler({
  errorMessage: FEEDBACK_ERROR,
  addMiddlewares: (stack) =>
    stack
      .use(httpJsonBodyParser())
      .use(
        zodPathParametersValidator(
          MessageFeedbackPathParametersSchema,
          FEEDBACK_ERROR,
        ),
      )
      .use(zodBodyValidator(MessageFeedbackBodySchema, FEEDBACK_ERROR)),
  handler: giveFeedback,
});
