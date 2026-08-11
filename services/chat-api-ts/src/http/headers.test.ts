import { describe, expect, it } from 'vitest';
import { lowercaseHeaders } from './headers.ts';

describe('lowercaseHeaders', () => {
  it('lowercases header keys and preserves their values', () => {
    expect(
      lowercaseHeaders({ 'End-User-Id': 'user-abc-123', 'X-Foo': 'bar' }),
    ).toEqual({ 'end-user-id': 'user-abc-123', 'x-foo': 'bar' });
  });

  it('does not throw for undefined headers', () => {
    expect(() => lowercaseHeaders(undefined)).not.toThrow();
    expect(lowercaseHeaders(undefined)).toEqual({});
  });

  it('does not throw for undefined header values', () => {
    expect(() => lowercaseHeaders({ 'End-User-Id': undefined })).not.toThrow();
    expect(lowercaseHeaders({ 'End-User-Id': undefined })).toEqual({
      'end-user-id': undefined,
    });
  });
});
