/**
 * Whether a written control still shows the approved value. A phone widget reformats what it is
 * given (adds a country code, spaces or dashes), so a telephone field compares its digits only:
 * the same number with or without a country-code prefix of at most three digits (a prefix is only
 * removed from a number that was approved with a "+").
 */
export function writtenValueMatches(
  control: { value: string; type?: string; getAttribute(name: string): string | null },
  approved: string,
): boolean {
  if (control.value === approved) return true;
  const type = (control.getAttribute("type") ?? control.type ?? "").toLowerCase();
  if (type !== "tel") return false;
  const written = control.value.replace(/[^0-9]/gu, "");
  const intended = approved.replace(/[^0-9]/gu, "");
  if (written.length < 7 || intended.length < 7) return false;
  // The widget added a country code, or removed the one the approved number spelled with a "+".
  if (written.length >= intended.length)
    return written.length - intended.length <= 3 && written.endsWith(intended);
  return (
    approved.trim().startsWith("+") &&
    intended.length - written.length <= 3 &&
    intended.endsWith(written)
  );
}
