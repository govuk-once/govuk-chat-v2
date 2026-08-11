import { vi, type Mock } from 'vitest';
import type { BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import type { Writable } from 'node:stream';

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

export function createResponseStream(): Writable {
  return {
    write: vi.fn<(chunk: unknown) => boolean>(),
    end: vi.fn<() => void>(),
  } as unknown as Writable;
}

export function writtenText(stream: Writable): string {
  const writeMock = stream.write as Mock<(chunk: unknown) => boolean>;
  return writeMock.mock.calls
    .map(([chunk]) =>
      Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
    )
    .join('');
}

export async function* asyncChunks(
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
