import { describe, expect, it } from 'vitest';
import { POST } from './route.ts';

describe('POST', () => {
  it('clears the thread cookie and redirects to the chat page', () => {
    const response = POST();

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.cookies.get('thread_id')?.value).toBe('');
  });
});
