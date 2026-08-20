import { z } from 'zod';

// We may want to use JSON schema validaiton or use an OpenAPI spec
// for request and response validation. These are quite easy to convert to
// and can be used as a reference if we decide to use another approach.

export const MessageSchema = z
  .object({
    id: z.uuid({ message: 'id must be a valid UUID' }),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().min(1, 'content must not be empty'),
  })
  .strict();

export type Message = z.infer<typeof MessageSchema>;

export const RunAgentInputSchema = z
  .object({
    threadId: z.uuid({ message: 'threadId must be a valid UUID' }),
    runId: z.uuid({ message: 'runId must be a valid UUID' }),
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
  })
  .strict();

const endUserIdSchema = z.uuid({ message: 'end-user-id must be a valid UUID' });

export const ClientInputHeadersSchema = z.object({
  'end-user-id':
    process.env.SKIP_END_USER_ID_VALIDATION === 'true'
      ? endUserIdSchema.optional()
      : endUserIdSchema,
});

export type RunAgentInputBody = z.infer<typeof RunAgentInputSchema>;
export type ClientInputHeaders = z.infer<typeof ClientInputHeadersSchema>;
