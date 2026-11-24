// A body that isn't JSON reads as undefined, for the route's schema to reject.
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
