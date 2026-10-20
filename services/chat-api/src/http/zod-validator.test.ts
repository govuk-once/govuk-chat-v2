import { describe, expect, it, vi } from 'vitest';
import middy from '@middy/core';
import { z } from 'zod';
import type { Context } from 'aws-lambda';
import { logger } from '../logging/logger.ts';
import {
  zodBodyValidator,
  zodHeadersValidator,
  zodPathParametersValidator,
  zodQueryValidator,
} from './zod-validator.ts';

const BODY_ERROR_MESSAGE = 'Test body rejected';
const HEADERS_ERROR_MESSAGE = 'Test headers rejected';
const PATH_PARAMS_ERROR_MESSAGE = 'Test path params rejected';
const QUERY_ERROR_MESSAGE = 'Test query rejected';

const TestBodySchema = z.object({
  name: z.string().min(1, 'name must not be empty'),
});

const TestHeadersSchema = z.object({
  'x-api-key': z.string({ message: 'x-api-key header is required' }),
});

function buildBodyHandler() {
  return middy()
    .use(zodBodyValidator(TestBodySchema, BODY_ERROR_MESSAGE))
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({ received: { body: event.body } }),
    }));
}

function buildHeadersHandler() {
  return middy()
    .use(zodHeadersValidator(TestHeadersSchema, HEADERS_ERROR_MESSAGE))
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({ received: { headers: event.headers } }),
    }));
}

type BodyEvent = Parameters<ReturnType<typeof buildBodyHandler>>[0];
type HeadersEvent = Parameters<ReturnType<typeof buildHeadersHandler>>[0];

describe('zodBodyValidator', () => {
  it('replaces event.body with the parsed data and calls through to the handler when valid', async () => {
    const handler = buildBodyHandler();

    const response = await handler(
      { body: { name: 'Alice' } } as unknown as BodyEvent,
      {} as Context,
    );

    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({ received: { body: { name: 'Alice' } } }),
    });
  });

  it('short-circuits with a 422 and details when the body is invalid, without calling the handler', async () => {
    const handler = buildBodyHandler();

    const response = await handler(
      { body: { name: '' } } as unknown as BodyEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.error).toBe(BODY_ERROR_MESSAGE);
    expect(parsed.details.fieldErrors).toHaveProperty('name');
    // If the handler had run, `received` would be present in the body instead.
    expect(parsed).not.toHaveProperty('received');
  });

  it("warns rather than errors when the body is invalid, as the fault is the client's", async () => {
    const logWarn = vi.spyOn(logger, 'warn');
    const logError = vi.spyOn(logger, 'error');
    const handler = buildBodyHandler();

    await handler(
      { body: { name: '' } } as unknown as BodyEvent,
      {} as Context,
    );

    expect(logWarn).toHaveBeenCalledWith('Request failed schema validation', {
      error: expect.any(z.ZodError),
      target: 'body',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('treats a missing body as an empty object to validate against', async () => {
    const handler = buildBodyHandler();

    const response = await handler({} as unknown as BodyEvent, {} as Context);

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.details.fieldErrors).toHaveProperty('name');
  });
});

describe('zodHeadersValidator', () => {
  it('merges event.headers with the parsed data and calls through to the handler when valid', async () => {
    const handler = buildHeadersHandler();

    const response = await handler(
      {
        headers: { 'x-api-key': 'secret', other: 'header' },
      } as unknown as HeadersEvent,
      {} as Context,
    );

    // 'other' surviving matters: middleware further down the chain relies on
    // headers this schema doesn't describe.
    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        received: {
          headers: { 'x-api-key': 'secret', other: 'header' },
        },
      }),
    });
  });

  it('short-circuits with a 422 and details when the headers are invalid, without calling the handler', async () => {
    const handler = buildHeadersHandler();

    const response = await handler(
      { headers: {} } as unknown as HeadersEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.error).toBe(HEADERS_ERROR_MESSAGE);
    expect(parsed.details.fieldErrors).toHaveProperty('x-api-key');
    // If the handler had run, `received` would be present in the body instead.
    expect(parsed).not.toHaveProperty('received');
  });

  it('warns with a headers target when the headers are invalid', async () => {
    const logWarn = vi.spyOn(logger, 'warn');
    const handler = buildHeadersHandler();

    await handler({ headers: {} } as unknown as HeadersEvent, {} as Context);

    expect(logWarn).toHaveBeenCalledWith('Request failed schema validation', {
      error: expect.any(z.ZodError),
      target: 'headers',
    });
  });

  it('treats missing headers as an empty object to validate against', async () => {
    const handler = buildHeadersHandler();

    const response = await handler(
      {} as unknown as HeadersEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.details.fieldErrors).toHaveProperty('x-api-key');
  });
});

const TestPathParametersSchema = z.object({
  id: z.uuid({ message: 'id must be a valid UUID' }),
});

const TestQuerySchema = z.object({
  limit: z.string().optional().default('10').transform(Number),
});

function buildPathParametersHandler() {
  return middy()
    .use(
      zodPathParametersValidator(
        TestPathParametersSchema,
        PATH_PARAMS_ERROR_MESSAGE,
      ),
    )
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({
        received: { pathParameters: event.pathParameters },
      }),
    }));
}

function buildQueryHandler() {
  return middy()
    .use(zodQueryValidator(TestQuerySchema, QUERY_ERROR_MESSAGE))
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({
        received: { queryStringParameters: event.queryStringParameters },
      }),
    }));
}

type PathParametersEvent = Parameters<
  ReturnType<typeof buildPathParametersHandler>
>[0];
type QueryEvent = Parameters<ReturnType<typeof buildQueryHandler>>[0];

describe('zodPathParamsValidator', () => {
  it('replaces event.pathParameters with the parsed data when valid', async () => {
    const handler = buildPathParametersHandler();
    const id = crypto.randomUUID();

    const response = await handler(
      { pathParameters: { id } } as unknown as PathParametersEvent,
      {} as Context,
    );

    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({ received: { pathParameters: { id } } }),
    });
  });

  it('short-circuits with a 422 when the path parameters are invalid', async () => {
    const handler = buildPathParametersHandler();

    const response = await handler(
      {
        pathParameters: { id: 'not-a-uuid' },
      } as unknown as PathParametersEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.error).toBe(PATH_PARAMS_ERROR_MESSAGE);
    expect(parsed.details.fieldErrors).toHaveProperty('id');
  });

  it('treats missing pathParameters as an empty object to validate against', async () => {
    const handler = buildPathParametersHandler();

    const response = await handler(
      {} as unknown as PathParametersEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.details.fieldErrors).toHaveProperty('id');
  });
});

describe('zodQueryValidator', () => {
  it('replaces event.queryStringParameters with the parsed data when valid', async () => {
    const handler = buildQueryHandler();

    const response = await handler(
      { queryStringParameters: { limit: '25' } } as unknown as QueryEvent,
      {} as Context,
    );

    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        received: { queryStringParameters: { limit: 25 } },
      }),
    });
  });

  it('applies defaults when query parameters are absent', async () => {
    const handler = buildQueryHandler();

    const response = await handler(
      { queryStringParameters: {} } as unknown as QueryEvent,
      {} as Context,
    );

    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        received: { queryStringParameters: { limit: 10 } },
      }),
    });
  });

  it('treats missing queryStringParameters as an empty object to validate against', async () => {
    const handler = buildQueryHandler();

    const response = await handler({} as unknown as QueryEvent, {} as Context);

    const parsed = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(parsed.received.queryStringParameters).toEqual({ limit: 10 });
  });
});
