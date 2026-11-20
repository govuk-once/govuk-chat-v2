import { z } from 'zod';
import { AssistantMessageSchema, UserMessageSchema } from '@ag-ui/core/schemas';

export const UserTurnMessagesSchema = z.tuple([UserMessageSchema.strict()]);

export const AssistantTurnMessagesSchema = z.array(
  AssistantMessageSchema.strict(),
);

export type UserTurnMessages = z.infer<typeof UserTurnMessagesSchema>;
export type AssistantTurnMessages = z.infer<typeof AssistantTurnMessagesSchema>;
