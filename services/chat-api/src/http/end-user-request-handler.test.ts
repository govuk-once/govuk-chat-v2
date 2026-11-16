import { describe, expect, it } from 'vitest';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import { z } from 'zod';
import type { APIGatewayProxyResult, Context } from 'aws-lambda';
import { apiGatewayProxyEventFixture } from '../test-utils/api-gateway.ts';
import { zodBodyValidator } from './zod-validator.ts';
import { endUserRequestHandler } from './end-user-request-handler.ts';

const ERROR_MESSAGE = 'Test request error';
const END_USER_ID_HEADER = { 'end-user-id': crypto.randomUUID() };

const TestBodySchema = z.object({ name: z.string().min(1) });

function buildHandler(
  handler: (event: {
    body: { name: string };
  }) => Promise<APIGatewayProxyResult>,
) {
  return endUserRequestHandler({
    errorMessage: ERROR_MESSAGE,
    middleware: (stack) =>
      stack
        .use(httpJsonBodyParser())
        .use(zodBodyValidator(TestBodySchema, ERROR_MESSAGE)),
    handler,
  });
}

async function runHandler(
  handler: ReturnType<typeof buildHandler>,
  body: string,
  headers: Record<string, string> = END_USER_ID_HEADER,
) {
  const response = await handler(
    apiGatewayProxyEventFixture(body, headers) as unknown as Parameters<
      typeof handler
    >[0],
    {} as Context,
  );
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

describe('endUserRequestHandler', () => {
  it('passes the event from the handler middleware to the handler', async () => {
    const handler = buildHandler(async (event) => ({
      statusCode: 200,
      body: JSON.stringify(event.body),
    }));

    expect(
      await runHandler(handler, JSON.stringify({ name: 'Alice' })),
    ).toEqual({ statusCode: 200, body: { name: 'Alice' } });
  });

  it('rejects an invalid end-user-id header before the handler middleware runs', async () => {
    const handler = buildHandler(async () => ({ statusCode: 200, body: '{}' }));

    const response = await runHandler(handler, JSON.stringify({ name: '' }), {
      'end-user-id': 'not-a-uuid',
    });

    expect(response.statusCode).toBe(422);
    expect(response.body.error).toBe(ERROR_MESSAGE);
    expect(Object.keys(response.body.details.fieldErrors)).toEqual([
      'end-user-id',
    ]);
  });

  it('turns an error thrown by the handler into a JSON 500', async () => {
    const handler = buildHandler(async () => {
      throw new Error('Handler failure');
    });

    expect(
      await runHandler(handler, JSON.stringify({ name: 'Alice' })),
    ).toEqual({ statusCode: 500, body: { error: ERROR_MESSAGE } });
  });
});
