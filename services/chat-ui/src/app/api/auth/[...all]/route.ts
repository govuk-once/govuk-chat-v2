import { getAuth } from '../../../../auth/auth.ts';

// Better Auth serves sign-in, the OAuth callback and sign-out under
// /api/auth.
async function handle(request: Request): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
