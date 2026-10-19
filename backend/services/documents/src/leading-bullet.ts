// The standard PDF font cannot encode visual bullet glyphs such as the black circle, and an unencodable
// character ends the dedicated native process before any material exists. A leading marker is a layout
// symbol, not candidate wording, so it is written as the supported bullet. Every other character is left
// exactly as the candidate wrote it; anything the font still cannot encode is refused, never substituted.
const LEADING_VISUAL_BULLET =
  /^[\u25cf\u25e6\u2043\u2219\u25aa\u25a0\u25cb\u2023\u25c6\u27a2\u25ba\u25b6](?=\s)/u;

/** Replaces only a leading visual bullet marker (followed by whitespace) with the standard bullet. */
export function canonicalizeLeadingBullet(text: string): string {
  return text.replace(LEADING_VISUAL_BULLET, "\u2022");
}
