import { z } from 'zod';
import { ClientInputHeadersSchema } from '../schemas/client-input.ts';

// TODO: We will likely want to replace this and not worry about
// header normalisation oursevles.
export function lowercaseHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

export type EndUserIdResult =
  | { success: true; endUserId: string | undefined }
  | {
      success: false;
      error: z.ZodFlattenedError<z.infer<typeof ClientInputHeadersSchema>>;
    };

export function parseEndUserId(
  headers: Record<string, string | undefined> | undefined,
): EndUserIdResult {
  const parsed = ClientInputHeadersSchema.safeParse(lowercaseHeaders(headers));
  if (!parsed.success) {
    return { success: false, error: z.flattenError(parsed.error) };
  }

  return { success: true, endUserId: parsed.data['end-user-id'] };
}
