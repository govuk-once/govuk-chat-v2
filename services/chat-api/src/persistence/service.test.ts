import { describe, expect, it, vi } from 'vitest';
import { stubDynamoDBDocumentClient } from '../test-utils/dynamodb.ts';

describe('configuration', () => {
  it('throws an error during module import when CHAT_API_TABLE_NAME is not configured', async () => {
    stubDynamoDBDocumentClient();
    vi.resetModules();
    vi.stubEnv('CHAT_API_TABLE_NAME', undefined);

    await expect(import('./service.ts')).rejects.toThrow(
      'CHAT_API_TABLE_NAME is not configured',
    );
  });
});
