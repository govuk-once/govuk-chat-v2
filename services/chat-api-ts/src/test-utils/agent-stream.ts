import { vi } from 'vitest';
import type { BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { PassThrough } from 'node:stream';

export const send = vi.fn();
export const encoder = new EventEncoder();

export const invokeAgentRuntimeCommand = vi.fn().mockImplementation(function (
  input: unknown,
) {
  return { input };
});

// vi.mock must run at module load time (it's hoisted above imports) to intercept
// @aws-sdk/client-bedrock-agentcore before real code imports it.
// eslint-disable-next-line unicorn/no-top-level-side-effects
vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: vi.fn().mockImplementation(function () {
    return { send };
  }),
  InvokeAgentRuntimeCommand: invokeAgentRuntimeCommand,
}));

export function stubAwsLambdaGlobal(): void {
  vi.stubGlobal('awslambda', {
    streamifyResponse: (function_: unknown) => function_,
    HttpResponseStream: {
      from: (responseStream: unknown, _metadata: unknown) => responseStream,
    },
  });
}

async function* asyncChunks(
  chunks: Array<Uint8Array | string>,
): AsyncGenerator<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

export async function* createFailingStream(
  events: Array<Uint8Array | string> = [],
): AsyncGenerator<Buffer> {
  for (const event of events) {
    yield Buffer.from(event);
  }
  throw new Error('Stream failure');
}

export function aguiEventStream(events: BaseEvent[]): AsyncGenerator<Buffer> {
  return asyncChunks(events.map((event) => encoder.encode(event)));
}

export function createResponseStream(): PassThrough {
  return new PassThrough();
}

export function writtenText(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}
