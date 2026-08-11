import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1, 'content must not be empty'),
});

export type Message = z.infer<typeof MessageSchema>;

export const RunAgentInputSchema = z.object({
  threadId: z.uuid({ message: 'threadId must be a valid UUID' }),
  runId: z.uuid({ message: 'runId must be a valid UUID' }).optional(),
  parentRunId: z.never().optional(),
  state: z.object({}).strict().optional(),
  forwardedProps: z.object({}).strict().optional(),
  messages: z
    .array(MessageSchema)
    .min(1, 'messages must contain at least one message')
    .refine((messages) => messages.at(-1)?.role === 'user', {
      message: 'the last message must be a user message',
    }),
  tools: z.tuple([]).optional(),
  context: z.tuple([]).optional(),
});

export type RunAgentInputBody = z.infer<typeof RunAgentInputSchema>;
