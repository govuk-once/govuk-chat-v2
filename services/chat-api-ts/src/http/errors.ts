import type { Writable } from 'node:stream';
import type { z } from 'zod';

export type FlattenedError = ReturnType<typeof z.flattenError>;

export interface SimpleErrorBody {
  error: string;
}

export interface ValidationErrorBody {
  error: string;
  details: FlattenedError;
}

export type ErrorBody = SimpleErrorBody | ValidationErrorBody;

export function streamedJsonErrorResponse(
  responseStream: Writable,
  statusCode: number,
  body: ErrorBody,
): void {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
  stream.write(JSON.stringify(body));
  stream.end();
}

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
