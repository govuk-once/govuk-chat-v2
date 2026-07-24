import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from './hello-world.ts';

describe('handler', () => {
  it('returns a 200 with a hello world message', async () => {
    const event = {} as APIGatewayProxyEvent;

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Hello, world!',
    });
  });
});
