import { beforeAll, describe, expect, it } from 'vitest';
import {
  createResponseStream,
  expectJsonHttpResponse,
  stubAwsLambdaGlobal,
} from '../test-utils/agent-stream.ts';
import { buildJsonErrorResponse, streamedJsonErrorResponse } from './errors.ts';

beforeAll(() => {
  stubAwsLambdaGlobal();
});

describe('streamedJsonErrorResponse', () => {
  it('writes a closed JSON stream response with the given status code and content type', () => {
    const responseStream = createResponseStream();

    streamedJsonErrorResponse(responseStream, 400, {
      error: 'Invalid request body',
    });

    expectJsonHttpResponse(responseStream, 400, {
      error: 'Invalid request body',
    });
    expect(responseStream.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(responseStream.end).toHaveBeenCalledOnce();
  });
});

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
