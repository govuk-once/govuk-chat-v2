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
