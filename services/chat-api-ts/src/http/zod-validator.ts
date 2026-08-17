import type { MiddlewareObj, Request } from '@middy/core';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { buildJsonErrorResponse } from './errors.ts';

export function zodBodyValidator<T extends z.ZodTypeAny>(
  schema: T,
): MiddlewareObj<APIGatewayProxyEvent> {
  return {
    before: (request: Request<APIGatewayProxyEvent>) => {
      const result = schema.safeParse(request.event.body ?? {});
      if (!result.success) {
        return buildJsonErrorResponse(422, {
          error: 'Invalid request body',
          details: z.flattenError(result.error),
        });
      }

      (request.event as { body: unknown }).body = result.data;
    },
  };
}

export function zodHeadersValidator<
  T extends z.ZodType<Record<string, string>>,
>(schema: T): MiddlewareObj<APIGatewayProxyEvent> {
  return {
    before: (request: Request<APIGatewayProxyEvent>) => {
      const result = schema.safeParse(request.event.headers ?? {});
      if (!result.success) {
        return buildJsonErrorResponse(422, {
          error: 'Invalid request headers',
          details: z.flattenError(result.error),
        });
      }
      request.event.headers = {
        ...request.event.headers,
        ...result.data,
      };
    },
  };
}
