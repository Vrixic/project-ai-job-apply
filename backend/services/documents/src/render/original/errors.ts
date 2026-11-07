/**
 * The original page cannot be edited in place (an unsupported structure, or an edit that would have
 * to move text onto another page). The caller draws the resume the other way instead. The code is a
 * fixed word: it never carries any resume text.
 */
export type OriginalEditReason =
  | "CONTENT_TOO_LARGE"
  | "CONTENT_MALFORMED"
  | "ENCRYPTED"
  | "ROTATED_OR_OFFSET_PAGE"
  | "PAGE_COUNT"
  | "UNSUPPORTED_CONTENT_FILTER"
  | "TEXT_IN_FORM_OR_PATTERN"
  | "UNSUPPORTED_TEXT_STATE"
  | "TEXT_NOT_MATCHED"
  | "LINE_NOT_FOUND"
  | "AMBIGUOUS_GRAPHIC"
  | "MOVES_BETWEEN_PAGES"
  | "MOVES_BETWEEN_ZONES"
  | "STATE_DIFFERS"
  | "UNSAFE_OBJECT"
  | "RESOURCE_UNSUPPORTED"
  | "OUTPUT_TOO_LARGE";

export class OriginalEditUnsupported extends Error {
  constructor(readonly reasonCode: OriginalEditReason) {
    super("The original resume page cannot be edited in place");
    this.name = "OriginalEditUnsupported";
  }
}
