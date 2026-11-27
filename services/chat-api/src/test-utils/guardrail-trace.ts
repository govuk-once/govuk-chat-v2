import { EventType, type RawEvent } from '@ag-ui/core';

function guardrailTraceEvent(guardrail: Record<string, unknown>): RawEvent {
  return {
    type: EventType.RAW,
    event: { event: { metadata: { trace: { guardrail } } } },
    source: 'strands',
  };
}

export const userMessageBlockedTraceEvent = guardrailTraceEvent({
  inputAssessment: {
    'guardrail-id': {
      contentPolicy: {
        filters: [
          {
            type: 'PROMPT_ATTACK',
            confidence: 'MEDIUM',
            filterStrength: 'HIGH',
            action: 'BLOCKED',
            detected: true,
          },
        ],
      },
    },
  },
  actionReason: 'Guardrail blocked.',
});

export const answerBlockedTraceEvent = guardrailTraceEvent({
  inputAssessment: { 'guardrail-id': {} },
  outputAssessments: {
    'guardrail-id': [
      {
        topicPolicy: {
          topics: [
            {
              name: 'Passports',
              type: 'DENY',
              action: 'BLOCKED',
              detected: true,
            },
          ],
        },
      },
    ],
  },
  actionReason: 'No action.\nGuardrail blocked.',
});
