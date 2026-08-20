import { describe, expect, it, vi } from 'vitest';
import { lowercaseHeaders, parseEndUserId } from './headers.ts';

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

describe('parseEndUserId', () => {
  const VALID_USER_ID = crypto.randomUUID();

  it('returns the end-user-id when header is a valid UUID', () => {
    const result = parseEndUserId({ 'end-user-id': VALID_USER_ID });

    expect(result).toEqual({ success: true, endUserId: VALID_USER_ID });
  });

  it('normalises header keys to lowercase before validation', () => {
    const result = parseEndUserId({ 'End-User-Id': VALID_USER_ID });

    expect(result).toEqual({ success: true, endUserId: VALID_USER_ID });
  });

  it('returns an error when end-user-id header is missing', () => {
    const result = parseEndUserId({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fieldErrors).toHaveProperty('end-user-id');
    }
  });

  it('returns an error when end-user-id is not a valid UUID', () => {
    const result = parseEndUserId({ 'end-user-id': 'not-a-uuid' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fieldErrors).toHaveProperty('end-user-id');
    }
  });

  it('skips validation and returns undefined endUserId when SKIP_END_USER_ID_VALIDATION is set', async () => {
    vi.stubEnv('SKIP_END_USER_ID_VALIDATION', 'true');
    vi.resetModules();

    const { parseEndUserId: parse } = await import('./headers.ts');
    const result = parse({});

    expect(result).toEqual({ success: true, endUserId: undefined });
  });
});
