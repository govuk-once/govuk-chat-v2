import { describe, expect, it } from 'vitest';
import middy from '@middy/core';
import { z } from 'zod';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { zodBodyValidator, zodHeadersValidator } from './zod-validator.ts';

const TestBodySchema = z.object({
  name: z.string().min(1, 'name must not be empty'),
});

const TestHeadersSchema = z.object({
  'x-api-key': z.string({ message: 'x-api-key header is required' }),
});

function buildBodyHandler() {
  return middy<APIGatewayProxyEvent>()
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({ received: { body: event.body } }),
    }))
    .use(zodBodyValidator(TestBodySchema));
}

function buildHeadersHandler() {
  return middy<APIGatewayProxyEvent>()
    .handler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify({ received: { headers: event.headers } }),
    }))
    .use(zodHeadersValidator(TestHeadersSchema));
}

describe('zodBodyValidator', () => {
  it('replaces event.body with the parsed data and calls through to the handler when valid', async () => {
    const handler = buildBodyHandler();

    const response = await handler(
      { body: { name: 'Alice' } } as unknown as APIGatewayProxyEvent,
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
      { body: { name: '' } } as unknown as APIGatewayProxyEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.error).toBe('Invalid request body');
    expect(parsed.details.fieldErrors).toHaveProperty('name');
    // If the handler had run, `received` would be present in the body instead.
    expect(parsed).not.toHaveProperty('received');
  });

  it('treats a missing body as an empty object to validate against', async () => {
    const handler = buildBodyHandler();

    const response = await handler(
      {} as unknown as APIGatewayProxyEvent,
      {} as Context,
    );

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
      } as unknown as APIGatewayProxyEvent,
      {} as Context,
    );

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
      { headers: {} } as unknown as APIGatewayProxyEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.error).toBe('Invalid request headers');
    expect(parsed.details.fieldErrors).toHaveProperty('x-api-key');
    // If the handler had run, `received` would be present in the body instead.
    expect(parsed).not.toHaveProperty('received');
  });

  it('treats missing headers as an empty object to validate against', async () => {
    const handler = buildHeadersHandler();

    const response = await handler(
      {} as unknown as APIGatewayProxyEvent,
      {} as Context,
    );

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body);
    expect(parsed.details.fieldErrors).toHaveProperty('x-api-key');
  });
});
