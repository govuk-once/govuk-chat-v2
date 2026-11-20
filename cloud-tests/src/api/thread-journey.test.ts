import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatApiClient } from './chat-api-client.ts';

// A dummy prompt for testing, asking for a short answer to keep runs quick
// and cheap. The test doesn't check what the answer says.
const PROMPT = 'In one short sentence, what is GOV.UK?';

describe('a thread journey', () => {
  let client: ChatApiClient;

  beforeAll(async () => {
    client = await ChatApiClient.connect();
  });

  it('streams a run, then stores it as a user turn and an assistant turn', async () => {
    const threadId = randomUUID();

    const eventTypes = await client.invokeThread(threadId, PROMPT);

    expect(eventTypes[0]).toBe('RUN_STARTED');
    expect(eventTypes).toContain('TEXT_MESSAGE_CONTENT');
    expect(eventTypes.at(-1)).toBe('RUN_FINISHED');

    const turns = await client.listTurns(threadId);

    expect(turns.map((turn) => turn.sender)).toEqual(['user', 'assistant']);
  });
});
