import { describe, expect, it } from 'vitest';
import { buildJsonErrorResponse } from './errors.ts';

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
