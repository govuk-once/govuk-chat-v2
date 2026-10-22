import { v5 as uuidv5 } from 'uuid';

// Changing this gives every user a new end user ID, which cuts them off from
// their existing threads.
const END_USER_ID_NAMESPACE = '20f2b8bb-8438-478a-bdaa-00f085ce6080';

// The Chat API needs end-user-id to be a UUID, but Cognito doesn't promise
// that a user's sub is one, so the sub is turned into a UUIDv5. The same sub
// always gives the same ID.
export function endUserIdFor(sub: string): string {
  return uuidv5(sub, END_USER_ID_NAMESPACE);
}
