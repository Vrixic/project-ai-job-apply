/** Pure captured-response and original-terminal metadata; no provider I/O or model authority. */
export interface OpenAiBackgroundResponseReference {
  schemaVersion: 1;
  responseId: string;
  createdAt: number;
}

export interface ProviderBackgroundTerminal {
  kind: "terminal_no_content";
  reference: OpenAiBackgroundResponseReference;
  terminalStatus: "failed" | "cancelled" | "incomplete";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateOpenAiBackgroundResponseReference(
  value: unknown,
): value is OpenAiBackgroundResponseReference {
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        ["schemaVersion", "responseId", "createdAt"].includes(key) &&
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      );
    })
  )
    return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.responseId === "string" &&
    /^resp_[a-zA-Z0-9]{1,128}$/u.test(value.responseId) &&
    typeof value.createdAt === "number" &&
    Number.isSafeInteger(value.createdAt) &&
    value.createdAt > 0
  );
}

export function validateProviderBackgroundTerminal(
  value: unknown,
): value is ProviderBackgroundTerminal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        ["kind", "reference", "terminalStatus"].includes(key) &&
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      );
    })
  )
    return false;
  const receipt = value as ProviderBackgroundTerminal;
  return (
    receipt.kind === "terminal_no_content" &&
    ["failed", "cancelled", "incomplete"].includes(receipt.terminalStatus) &&
    validateOpenAiBackgroundResponseReference(receipt.reference)
  );
}
