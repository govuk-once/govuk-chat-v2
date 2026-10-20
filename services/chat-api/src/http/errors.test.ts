import { describe, expect, it, vi } from 'vitest';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { logger } from '../logging/logger.ts';
import { buildJsonErrorResponse, jsonHttpErrorHandler } from './errors.ts';

describe('buildJsonErrorResponse', () => {
  it('builds a JSON response with the given status code and body', () => {
    const response = buildJsonErrorResponse(400, {
      error: 'Invalid request body',
    });

    expect(response).toEqual({
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request body' }),
    });
  });
});

interface ThrownError {
  statusCode?: number;
  message?: string;
  expose?: boolean;
}

function buildThrowingHandler(error: ThrownError) {
  return middy()
    .use(jsonHttpErrorHandler())
    .handler(async () => {
      throw Object.assign(new Error(error.message), error);
    });
}

describe('jsonHttpErrorHandler', () => {
  it('renders an exposable http error as JSON using its status and message', async () => {
    const handler = buildThrowingHandler({
      statusCode: 415,
      message: 'Unsupported Media Type',
    });

    const response = await handler({}, {} as Context);

    expect(response).toEqual({
      statusCode: 415,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unsupported Media Type' }),
    });
  });

  it('reports an error carrying no status code as a generic 500', async () => {
    const handler = buildThrowingHandler({ message: 'connection reset' });

    const response = await handler({}, {} as Context);

    expect(response.statusCode).toBe(500);
    // The underlying message would leak internals, so it must not be returned.
    expect(JSON.parse(response.body)).toEqual({
      error: 'Internal server error',
    });
  });

  it('does not expose the message of a server error that sets a status code', async () => {
    const handler = buildThrowingHandler({
      statusCode: 503,
      message: 'upstream pool exhausted',
    });

    const response = await handler({}, {} as Context);

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Internal server error',
    });
  });

  it('honours an explicit expose flag over the status code default', async () => {
    const handler = buildThrowingHandler({
      statusCode: 503,
      message: 'Service Unavailable',
      expose: true,
    });

    const response = await handler({}, {} as Context);

    expect(JSON.parse(response.body)).toEqual({
      error: 'Service Unavailable',
    });
  });

  it('warns rather than errors for a client error, as the fault is not ours', async () => {
    const logWarn = vi.spyOn(logger, 'warn');
    const logError = vi.spyOn(logger, 'error');
    const handler = buildThrowingHandler({
      statusCode: 415,
      message: 'Unsupported Media Type',
    });

    await handler({}, {} as Context);

    expect(logWarn).toHaveBeenCalledWith(
      'Request rejected before reaching the handler',
      { error: expect.any(Error), statusCode: 415 },
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('errors for a server failure, including one with no status code', async () => {
    const logWarn = vi.spyOn(logger, 'warn');
    const logError = vi.spyOn(logger, 'error');
    const handler = buildThrowingHandler({ message: 'connection reset' });

    await handler({}, {} as Context);

    expect(logError).toHaveBeenCalledWith(
      'Request failed with an unhandled error',
      { error: expect.any(Error), statusCode: 500 },
    );
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('does not log when a response has already been produced', async () => {
    const logWarn = vi.spyOn(logger, 'warn');
    const logError = vi.spyOn(logger, 'error');
    const handler = middy()
      .use(jsonHttpErrorHandler())
      .use({
        onError: (request) => {
          request.response = buildJsonErrorResponse(422, { error: 'handled' });
        },
      })
      .handler(async () => {
        throw Object.assign(new Error('boom'), { statusCode: 500 });
      });

    await handler({}, {} as Context);

    expect(logWarn).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('leaves a response alone when one has already been produced', async () => {
    const alreadyHandled = buildJsonErrorResponse(422, { error: 'handled' });
    const handler = middy()
      .use(jsonHttpErrorHandler())
      .use({
        onError: (request) => {
          request.response = alreadyHandled;
        },
      })
      .handler(async () => {
        throw Object.assign(new Error('boom'), { statusCode: 500 });
      });

    const response = await handler({}, {} as Context);

    expect(response).toEqual(alreadyHandled);
  });
});
