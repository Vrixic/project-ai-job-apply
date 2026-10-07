import type { TemporaryMaterialReference } from "./temporary-material-reference.js";
import { validateTemporaryMaterialReference } from "./temporary-material-reference.js";

/** Grounding metadata only, published after memory verification and both renderers succeed. */
export interface NativeMaterialReady {
  schemaVersion: 1;
  material: TemporaryMaterialReference;
  sourceFactIds: readonly string[];
  confidence: number;
}
export function validateNativeMaterialReady(value: unknown): value is NativeMaterialReady {
  try {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
      return false;
    const keys = ["schemaVersion", "material", "sourceFactIds", "confidence"];
    if (Reflect.ownKeys(value).length !== keys.length) return false;
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d?.enumerable || !("value" in d)) return false;
    }
    const ready = value as NativeMaterialReady;
    const facts = ready.sourceFactIds;
    return (
      ready.schemaVersion === 1 &&
      validateTemporaryMaterialReference(ready.material) &&
      ready.material.kind === "cover_letter" &&
      Array.isArray(facts) &&
      Object.getPrototypeOf(facts) === Array.prototype &&
      facts.length >= 1 &&
      facts.length <= 40 &&
      Reflect.ownKeys(facts).length === facts.length + 1 &&
      Array.from({ length: facts.length }, (_, index) => {
        const d = Object.getOwnPropertyDescriptor(facts, String(index));
        return (
          d?.enumerable === true &&
          "value" in d &&
          typeof d.value === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(d.value)
        );
      }).every(Boolean) &&
      new Set(facts).size === facts.length &&
      Number.isFinite(ready.confidence) &&
      ready.confidence > 0 &&
      ready.confidence <= 1
    );
  } catch {
    return false;
  }
}
