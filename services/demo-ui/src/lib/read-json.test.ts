import { describe, expect, it } from 'vitest';
import { readJson } from './read-json.ts';

function request(body: string): Request {
  return new Request('http://localhost/', { method: 'POST', body });
}

describe('readJson', () => {
  it('returns the parsed body', async () => {
    expect(await readJson(request('{"reaction":"positive"}'))).toEqual({
      reaction: 'positive',
    });
  });

  it('returns undefined when the body is not JSON', async () => {
    expect(await readJson(request('not json'))).toBeUndefined();
  });
});
