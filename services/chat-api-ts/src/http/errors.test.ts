import { describe, expect, it } from 'vitest';
import { buildJsonErrorResponse } from './errors.ts';

describe('buildJsonErrorResponse', () => {
  it('builds a plain response object with the given status code and JSON body', () => {
    const response = buildJsonErrorResponse(400, {
      error: 'Invalid request body',
    });

    expect(response).toEqual({
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request body' }),
    });
  });

  it('includes validation details when provided', () => {
    const details = {
      formErrors: [],
      fieldErrors: {
        threadId: ['threadId must be a valid UUID'],
      },
    };

    const response = buildJsonErrorResponse(422, {
      error: 'Invalid request body',
      details,
    });

    expect(JSON.parse(response.body)).toEqual({
      error: 'Invalid request body',
      details,
    });
  });
});
