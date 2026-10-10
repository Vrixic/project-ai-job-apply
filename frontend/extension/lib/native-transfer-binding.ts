/** Closed transport metadata equality: JSONB object ordering is not part of the binding. */
export function sameNativeTransferBinding(left: unknown, right: unknown, depth = 0): boolean {
  if (typeof left !== typeof right) return false;
  if (typeof left === "number") return Number.isFinite(left) && left === right;
  if (typeof left === "string" || typeof left === "boolean" || left === null) return left === right;
  if (typeof left !== "object" || !left || !right || depth >= 4) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length <= 2 &&
      left.length === right.length &&
      left.every((value, index) => sameNativeTransferBinding(value, right[index], depth + 1))
    );
  }
  if (
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length <= 16 &&
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameNativeTransferBinding(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          depth + 1,
        ),
    )
  );
}
