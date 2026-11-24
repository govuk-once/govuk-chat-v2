import { describe, expect, it } from 'vitest';
import { basicGuardrailConfig } from './basic-guardrail.ts';

describe('basicGuardrailConfig', () => {
  it('blocks prompt attacks in user messages', () => {
    expect(basicGuardrailConfig.contentPolicyConfig).toMatchObject({
      filtersConfig: expect.arrayContaining([
        expect.objectContaining({
          type: 'PROMPT_ATTACK',
          inputAction: 'BLOCK',
        }),
      ]),
    });
  });
});
