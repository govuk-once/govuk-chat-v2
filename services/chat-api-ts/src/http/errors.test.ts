import { beforeAll, describe, expect, it } from 'vitest';
import {
  createResponseStream,
  expectJsonHttpResponse,
  stubAwsLambdaGlobal,
} from '../test-utils/agent-stream.ts';
import { streamedJsonErrorResponse } from './errors.ts';

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
