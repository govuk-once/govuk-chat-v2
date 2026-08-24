import { expect, vi } from 'vitest';
import type { BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { Writable } from 'node:stream';

export const send = vi.fn();
export const encoder = new EventEncoder();

export const invokeAgentRuntimeCommand = vi.fn().mockImplementation(function (
  input: unknown,
) {
  return { input };
});

export function stubBedrockAgentCoreClient(): void {
  vi.doMock('@aws-sdk/client-bedrock-agentcore', () => ({
    BedrockAgentCoreClient: vi.fn().mockImplementation(function () {
      return { send };
    }),
    InvokeAgentRuntimeCommand: invokeAgentRuntimeCommand,
  }));
}

export class ResponseStream extends Writable {
  private chunks: Buffer[] = [];
  statusCode?: number;
  headers?: Record<string, string>;

  // eslint-disable-next-line unicorn/prefer-private-class-fields
  _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  read(): string {
    return Buffer.concat(this.chunks).toString();
  }
}

export function stubAwsLambdaGlobal(): void {
  vi.stubGlobal('awslambda', {
    streamifyResponse: (function_: unknown) => function_,
    HttpResponseStream: {
      from: (
        responseStream: ResponseStream,
        metadata: { statusCode: number; headers?: Record<string, string> },
      ) => {
        responseStream.statusCode = metadata.statusCode;
        responseStream.headers = metadata.headers;
        return responseStream;
      },
    },
  });
}

export function createResponseStream(): ResponseStream {
  const stream = new ResponseStream();
  vi.spyOn(stream, 'end');
  return stream;
}

export function expectJsonHttpResponse(
  responseStream: ResponseStream,
  statusCode: number,
  body: unknown,
): void {
  expect(responseStream.statusCode).toBe(statusCode);
  expect(JSON.parse(responseStream.read())).toEqual(body);
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
