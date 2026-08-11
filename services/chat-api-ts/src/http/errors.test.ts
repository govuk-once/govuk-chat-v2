import { beforeAll, describe, expect, it } from 'vitest';
import {
  createResponseStream,
  writtenText,
  stubAwsLambdaGlobal,
} from '../test-utils/agent-stream.ts';
import { writeJsonErrorResponse } from './errors.ts';

beforeAll(() => {
  stubAwsLambdaGlobal();
});

describe('writeJsonErrorResponse', () => {
  it('writes a JSON body with the given status code and content type', () => {
    const responseStream = createResponseStream();

    writeJsonErrorResponse(responseStream, 400, {
      error: 'Invalid request body',
    });

    expect(JSON.parse(writtenText(responseStream))).toEqual({
      error: 'Invalid request body',
    });
    expect(responseStream.end).toHaveBeenCalledOnce();
  });

  it('writes validation details when provided', () => {
    const responseStream = createResponseStream();

    const details = {
      formErrors: [],
      fieldErrors: {
        threadId: ['threadId must be a valid UUID'],
      },
    };

    writeJsonErrorResponse(responseStream, 400, {
      error: 'Invalid request body',
      details,
    });

    expect(JSON.parse(writtenText(responseStream))).toEqual({
      error: 'Invalid request body',
      details,
    });
  });

  it('passes through the given status code', () => {
    const responseStream = createResponseStream();

    writeJsonErrorResponse(responseStream, 500, {
      error: 'AGENT_RUNTIME_ARN is not configured',
    });

    expect(JSON.parse(writtenText(responseStream))).toEqual({
      error: 'AGENT_RUNTIME_ARN is not configured',
    });
  });
});
