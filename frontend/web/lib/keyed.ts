/** Stable keys for a static list whose texts may repeat: the text plus its occurrence number. */
export function keyed<T>(
  items: readonly T[],
  textOf: (item: T) => string,
): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { key: `${text}#${count}`, item };
  });
}
