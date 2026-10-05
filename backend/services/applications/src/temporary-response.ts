/** Process-local response guard. Never serialize this capability or retain response content. */
export interface TemporaryResponseControl {
  isCurrent(): boolean;
  release(): void;
  readonly signal?: AbortSignal;
}
const controls = new WeakMap<object, TemporaryResponseControl>();

export function bindTemporaryResponse(
  value: object,
  live: () => boolean,
  discard: () => void,
  close?: () => void,
  signal?: AbortSignal,
): void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      discard();
    } finally {
      close?.();
    }
  };
  const isCurrent = () => {
    try {
      if (!released && live()) return true;
    } catch {
      // Clock failure cannot extend a generated material's lifetime.
    }
    release();
    return false;
  };
  controls.set(value, Object.freeze({ isCurrent, release, ...(signal ? { signal } : {}) }));
}

/** Transport checks again before serialization and immediately before sending serialized bytes. */
export function temporaryResponseGuard(value: unknown): (() => boolean) | undefined {
  return temporaryResponseControl(value)?.isCurrent;
}

export function temporaryResponseControl(value: unknown): TemporaryResponseControl | undefined {
  return value !== null && typeof value === "object" ? controls.get(value) : undefined;
}
