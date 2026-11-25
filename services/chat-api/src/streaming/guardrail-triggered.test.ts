import { describe, expect, it } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { isStoppedByGuardrail } from './guardrail-triggered.ts';

function agentStopped(stopReason: string): BaseEvent {
  return {
    type: EventType.CUSTOM,
    name: 'AgentStopped',
    value: { stop_reason: stopReason },
  } as BaseEvent;
}

describe('isStoppedByGuardrail', () => {
  it('is true when the agent stopped because the guardrail stepped in', () => {
    expect(isStoppedByGuardrail(agentStopped('guardrail_intervened'))).toBe(
      true,
    );
  });

  it('is false when the agent stopped for another reason, or for any other event', () => {
    expect(isStoppedByGuardrail(agentStopped('max_tokens'))).toBe(false);
    expect(
      isStoppedByGuardrail({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'msg-1',
        delta: 'Hi',
      } as BaseEvent),
    ).toBe(false);
  });
});
