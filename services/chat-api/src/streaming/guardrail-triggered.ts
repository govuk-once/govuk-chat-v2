import { EventType, type BaseEvent, type CustomEvent } from '@ag-ui/core';
import { z } from 'zod';

// Shown in place of a blocked answer. With async checking, Bedrock never
// streams the guardrail's own blocked output message, so this is the only
// copy users see.
export const BLOCKED_MESSAGE =
  'The generated response did not meet our quality standards, please rephrase and ask again.';

export interface BlockedMessage {
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
