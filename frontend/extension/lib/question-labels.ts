const MAXIMUM_LABELS = 5;
const MAXIMUM_LENGTH = 120;

/**
 * The employer's wording of the first few questions still waiting for the candidate, made safe to
 * show: plain text on one line, no control, zero-width or direction-changing characters, bounded.
 * These are question labels from the page, never anything the candidate entered.
 */
export function questionLabels(labels: readonly string[]): string[] {
  return labels.slice(0, MAXIMUM_LABELS).map((label) => {
    // Control and format characters (zero-width, direction marks) go; line and paragraph
    // separators are whitespace and collapse with the rest.
    const plain = label
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!plain) return "(an unnamed question)";
    const characters = [...plain];
    return characters.length > MAXIMUM_LENGTH
      ? `${characters.slice(0, MAXIMUM_LENGTH - 1).join("")}…`
      : plain;
  });
}
