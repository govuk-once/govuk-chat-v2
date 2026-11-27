import { EventType, type BaseEvent, type CustomEvent } from '@ag-ui/core';
import { z } from 'zod';

// Shown in place of a blocked answer. With async checking, Bedrock never
// streams the guardrail's own blocked output message, so this is the only
// copy users see.
export const BLOCKED_MESSAGE =
  'The generated response did not meet our quality standards, please rephrase and ask again.';

export type BlockedRole = 'user' | 'assistant';

export interface BlockedMessage {
  blocked: BlockedRole;
  messageIds: string[];
  content: string;
}

export function guardrailTriggeredEvent(blocked: BlockedMessage): CustomEvent {
  return { type: EventType.CUSTOM, name: 'guardrailTriggered', value: blocked };
}

const AgentStoppedByGuardrailEventSchema = z.object({
  type: z.literal(EventType.CUSTOM),
  name: z.literal('AgentStopped'),
  value: z.object({ stop_reason: z.literal('guardrail_intervened') }),
});

export function isStoppedByGuardrail(event: BaseEvent): boolean {
  return (
    event.type === EventType.CUSTOM &&
    AgentStoppedByGuardrailEventSchema.safeParse(event).success
  );
}

const GuardrailTraceSchema = z.object({ inputAssessment: z.unknown() });

const ModelMetadataSchema = z.object({
  trace: z.object({ guardrail: GuardrailTraceSchema }),
});

const GuardrailTraceEventSchema = z.object({
  type: z.literal(EventType.RAW),
  event: z.object({ event: z.object({ metadata: ModelMetadataSchema }) }),
});

export type GuardrailTrace = z.infer<typeof GuardrailTraceSchema>;

export function guardrailTraceIn(event: BaseEvent): GuardrailTrace | undefined {
  const traceEvent = GuardrailTraceEventSchema.safeParse(event);
  return traceEvent.success
    ? traceEvent.data.event.event.metadata.trace.guardrail
    : undefined;
}

export function isUserMessageBlocked(trace: GuardrailTrace): boolean {
  return hasBlockedPolicy(trace.inputAssessment);
}

// The same rule as Strands' own _find_detected_and_blocked_policy: any
// policy, however deeply nested, that was detected and blocked.
// https://github.com/strands-agents/harness-sdk/blob/python/v1.65.0/strands-py/src/strands/models/bedrock.py#L1905-L1926
function hasBlockedPolicy(assessment: unknown): boolean {
  if (Array.isArray(assessment)) {
    return assessment.some((item) => hasBlockedPolicy(item));
  }
  if (typeof assessment !== 'object' || assessment === null) {
    return false;
  }
  if (
    'action' in assessment &&
    'detected' in assessment &&
    assessment.action === 'BLOCKED' &&
    assessment.detected === true
  ) {
    return true;
  }
  return Object.values(assessment).some((value) => hasBlockedPolicy(value));
}
