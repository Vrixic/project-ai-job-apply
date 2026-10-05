/** Process-local response guard. Never serialize this capability or retain response content. */
const guards = new WeakMap<object, () => boolean>();

export function bindTemporaryResponse(
  value: object,
  live: () => boolean,
  discard: () => void,
): void {
  guards.set(value, () => {
    try {
      if (live()) return true;
    } catch {
      // Clock failure cannot extend a generated material's lifetime.
    }
    discard();
    return false;
  });
}

/** Transport checks again before serialization and immediately before sending serialized bytes. */
export function temporaryResponseGuard(value: unknown): (() => boolean) | undefined {
  return value !== null && typeof value === "object" ? guards.get(value) : undefined;
}
