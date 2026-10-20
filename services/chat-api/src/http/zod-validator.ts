import type { MiddlewareObj, Request } from '@middy/core';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { buildJsonErrorResponse, type JsonErrorResponse } from './errors.ts';
import { logger } from '../logging/logger.ts';

export type ValidatedBodyEvent<T> = Omit<APIGatewayProxyEvent, 'body'> & {
  body: T;
};

export type ValidatedHeadersEvent<T> = Omit<APIGatewayProxyEvent, 'headers'> & {
  headers: T;
};

function validateAgainstSchema<S extends z.ZodType>(
  value: unknown,
  schema: S,
  errorMessage: string,
  target: string,
): { data: z.infer<S> } | { response: JsonErrorResponse } {
  const result = schema.safeParse(value);
  if (!result.success) {
    logger.warn('Request failed schema validation', {
      error: result.error,
      target,
    });
    return {
      response: buildJsonErrorResponse(422, {
        error: errorMessage,
        details: z.flattenError(result.error),
      }),
    };
  }

  return { data: result.data };
}

export function zodBodyValidator<T extends z.ZodType>(
  schema: T,
  errorMessage: string,
): MiddlewareObj<ValidatedBodyEvent<z.infer<T>>> {
  return {
    before: (request: Request<ValidatedBodyEvent<z.infer<T>>>) => {
      const result = validateAgainstSchema(
        request.event.body ?? {},
        schema,
        errorMessage,
        'body',
      );
      if ('response' in result) return result.response;

      request.event.body = result.data;
    },
  };
}

export function zodHeadersValidator<
  T extends z.ZodType<Record<string, string | undefined>>,
>(
  schema: T,
  errorMessage: string,
): MiddlewareObj<ValidatedHeadersEvent<z.infer<T>>> {
  return {
    before: (request: Request<ValidatedHeadersEvent<z.infer<T>>>) => {
      const result = validateAgainstSchema(
        request.event.headers ?? {},
        schema,
        errorMessage,
        'headers',
      );
      if ('response' in result) return result.response;

      request.event.headers = { ...request.event.headers, ...result.data };
    },
  };
}

export type ValidatedPathParametersEvent<T> = Omit<
  APIGatewayProxyEvent,
  'pathParameters'
> & {
  pathParameters: T;
};

export function zodPathParametersValidator<T extends z.ZodType>(
  schema: T,
  errorMessage: string,
): MiddlewareObj<ValidatedPathParametersEvent<z.infer<T>>> {
  return {
    before: (request: Request<ValidatedPathParametersEvent<z.infer<T>>>) => {
      const result = validateAgainstSchema(
        request.event.pathParameters ?? {},
        schema,
        errorMessage,
        'pathParameters',
      );
      if ('response' in result) return result.response;

      request.event.pathParameters = result.data;
    },
  };
}

export type ValidatedQueryEvent<T> = Omit<
  APIGatewayProxyEvent,
  'queryStringParameters'
> & {
  queryStringParameters: T;
};

export function zodQueryValidator<T extends z.ZodType>(
  schema: T,
  errorMessage: string,
): MiddlewareObj<ValidatedQueryEvent<z.infer<T>>> {
  return {
    before: (request: Request<ValidatedQueryEvent<z.infer<T>>>) => {
      const result = validateAgainstSchema(
        request.event.queryStringParameters ?? {},
        schema,
        errorMessage,
        'queryStringParameters',
      );
      if ('response' in result) return result.response;

      request.event.queryStringParameters = result.data;
    },
  };
}
