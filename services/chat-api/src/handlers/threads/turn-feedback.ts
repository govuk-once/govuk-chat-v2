import httpJsonBodyParser from '@middy/http-json-body-parser';
import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  TurnFeedbackBodySchema,
  TurnFeedbackPathParametersSchema,
  type ClientInputHeaders,
  type TurnFeedbackBody,
  type TurnFeedbackPathParameters,
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
  recordTurnFeedback,
  type TurnFeedbackOutcome,
} from '../../persistence/feedback.ts';

const FEEDBACK_ERROR = 'Feedback recording error';

const REJECTIONS: Record<
  Exclude<TurnFeedbackOutcome['status'], 'recorded'>,
  { statusCode: number; error: string }
> = {
  'turn-not-found': { statusCode: 404, error: 'Turn not found' },
  'already-provided': {
    statusCode: 409,
    error: 'Feedback has already been given for this turn',
  },
};

type GiveFeedbackEvent = ValidatedHeadersEvent<ClientInputHeaders> &
  ValidatedPathParametersEvent<TurnFeedbackPathParameters> &
  ValidatedBodyEvent<TurnFeedbackBody>;

async function giveFeedback(
  event: GiveFeedbackEvent,
): Promise<APIGatewayProxyResult | JsonErrorResponse> {
  const endUserId = event.headers['end-user-id'];
  const { threadId, turnId } = event.pathParameters;
  logger.appendKeys({ userThreadId: threadId, turnId });

  const thread = await lookupThread({ endUserId, userThreadId: threadId });
  if (!thread) {
    return buildJsonErrorResponse(404, { error: 'Thread not found' });
  }
  logger.appendKeys({ systemThreadId: thread.systemThreadId });

  const outcome = await recordTurnFeedback(
    { systemThreadId: thread.systemThreadId, turnId },
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
  middleware: (stack) =>
    stack
      .use(httpJsonBodyParser())
      .use(
        zodPathParametersValidator(
          TurnFeedbackPathParametersSchema,
          FEEDBACK_ERROR,
        ),
      )
      .use(zodBodyValidator(TurnFeedbackBodySchema, FEEDBACK_ERROR)),
  handler: giveFeedback,
});
