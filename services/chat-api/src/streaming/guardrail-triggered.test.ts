import { describe, expect, it } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/core';
import {
  guardrailTraceIn,
  isStoppedByGuardrail,
  isUserMessageBlocked,
  type GuardrailTrace,
} from './guardrail-triggered.ts';
import {
  answerBlockedTraceEvent,
  userMessageBlockedTraceEvent,
} from '../test-utils/guardrail-trace.ts';

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

function traceIn(event: BaseEvent): GuardrailTrace {
  const trace = guardrailTraceIn(event);
  if (!trace) {
    throw new Error('No guardrail trace in the event');
  }
  return trace;
}

describe('guardrailTraceIn', () => {
  it("returns the input assessment from the guardrail's trace", () => {
    expect(guardrailTraceIn(answerBlockedTraceEvent)).toEqual({
      inputAssessment: { 'guardrail-id': {} },
    });
  });

  it('returns nothing for a RAW event without a guardrail trace', () => {
    expect(
      guardrailTraceIn({
        type: EventType.RAW,
        event: { event: { messageStart: { role: 'assistant' } } },
      } as BaseEvent),
    ).toBeUndefined();
  });
});

describe('isUserMessageBlocked', () => {
  it("is true when the guardrail blocked the user's message", () => {
    expect(isUserMessageBlocked(traceIn(userMessageBlockedTraceEvent))).toBe(
      true,
    );
  });

  it('is false when the guardrail only blocked the answer', () => {
    expect(isUserMessageBlocked(traceIn(answerBlockedTraceEvent))).toBe(false);
  });
});
