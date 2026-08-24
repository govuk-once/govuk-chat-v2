import type { MiddlewareObj, Request } from '@middy/core';
import type { z } from 'zod';
import { logger } from '../logging/logger.ts';

export type FlattenedError = ReturnType<typeof z.flattenError>;

export interface SimpleErrorBody {
  error: string;
}

export interface ValidationErrorBody {
  error: string;
  details: FlattenedError;
}

export type ErrorBody = SimpleErrorBody | ValidationErrorBody;

export interface JsonErrorResponse {
  statusCode: number;
  headers: { 'Content-Type': 'application/json' };
  body: string;
}

export function buildJsonErrorResponse(
  statusCode: number,
  body: ErrorBody,
): JsonErrorResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface HttpErrorLike {
  statusCode?: number;
  message?: string;
  expose?: boolean;
}

export function jsonHttpErrorHandler(): MiddlewareObj<unknown> {
  return {
    onError: (request: Request<unknown>) => {
      // Something earlier in the chain already produced a response, so the
      // error has been handled and shouldn't be overwritten.
      if (request.response !== undefined) return;

      const error = (request.error ?? {}) as HttpErrorLike;
      const statusCode = error.statusCode ?? 500;
      const isExposable = error.expose ?? statusCode < 500;

      const logContext = { error: request.error, statusCode };
      if (statusCode < 500) {
        logger.warn('Request rejected before reaching the handler', logContext);
      } else {
        logger.error('Request failed with an unhandled error', logContext);
      }

      return buildJsonErrorResponse(statusCode, {
        error:
          isExposable && error.message
            ? error.message
            : 'Internal server error',
      });
    },
  };
}
