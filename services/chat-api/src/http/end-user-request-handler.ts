import middy, { type MiddyfiedHandler } from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { ClientInputHeadersSchema } from '../schemas/client-input.ts';
import { zodHeadersValidator } from './zod-validator.ts';
import { jsonHttpErrorHandler } from './errors.ts';
import { logger } from '../logging/logger.ts';

function endUserRequestStack(
  errorMessage: string,
  middyPlugin?: middy.PluginObject,
) {
  return middy(middyPlugin)
    .use(injectLambdaContext(logger, { resetKeys: true }))
    .use(httpHeaderNormalizer())
    .use(zodHeadersValidator(ClientInputHeadersSchema, errorMessage));
}

type EndUserRequestStack = ReturnType<typeof endUserRequestStack>;

/* eslint-disable @typescript-eslint/no-explicit-any -- matches any middy
   stack, as middy's own types do for middleware; the event type is then read
   back from the stack, so the handler is still checked against it */
type AnyMiddyStack = MiddyfiedHandler<any, any, any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface EndUserRequestHandlerOptions<TStack extends AnyMiddyStack, TResult> {
  errorMessage: string;
  middleware: (stack: EndUserRequestStack) => TStack;
  handler: (event: Parameters<TStack>[0]) => Promise<TResult>;
  middyPlugin?: middy.PluginObject;
}

/**
Wraps a handler for an end user's request in the middy stack the chat API
handlers share. `middleware` adds the handler's own middleware after
the `end-user-id` header has been validated, and the handler must accept
the event they produce.
*/
export function endUserRequestHandler<TStack extends AnyMiddyStack, TResult>({
  errorMessage,
  middleware,
  handler,
  middyPlugin,
}: EndUserRequestHandlerOptions<TStack, TResult>): MiddyfiedHandler<
  Parameters<TStack>[0],
  TResult
> {
  return (
    middleware(endUserRequestStack(errorMessage, middyPlugin))
      // Last, so its onError runs first and turns errors into JSON responses.
      // It sets the response rather than returning it, so the onError hooks
      // before it, such as the logger's key reset, still run.
      .use(jsonHttpErrorHandler(errorMessage))
      .handler(handler)
  );
}
