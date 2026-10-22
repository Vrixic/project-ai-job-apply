import { createHash } from "node:crypto";

export class RenderError extends Error {
  constructor(readonly reasonCode: "UNSUPPORTED_CHARACTER" | "EMPTY_DOCUMENT" | "TOO_LONG") {
    super("The resume cannot be rendered in this format");
    this.name = "RenderError";
  }
}

export interface RenderedDocument {
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  bytes: Uint8Array;
  sha256: string;
  pageCount?: number;
}

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// WinAnsi code points that differ from Latin-1: the 0x80-0x9F block of Windows-1252.
export const WIN_ANSI: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

/** The WinAnsi code of one character; anything the standard fonts cannot draw is refused. */
export function winAnsiCode(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  const mapped = WIN_ANSI.get(codePoint);
  // Mapped WinAnsi codes live in 0x80-0x9F, which are only valid as the mapped characters.
  if (
    mapped === undefined &&
    (codePoint < 32 || (codePoint > 126 && codePoint < 160) || codePoint > 255)
  ) {
    throw new RenderError("UNSUPPORTED_CHARACTER");
  }
  return mapped ?? codePoint;
}

export function pdfString(text: string): string {
  let encoded = "";
  for (const character of text) {
    const code = winAnsiCode(character);
    if (character === "\\" || character === "(" || character === ")") encoded += `\\${character}`;
    else if (code > 126) encoded += `\\${code.toString(8).padStart(3, "0")}`;
    else encoded += character;
  }
  return encoded;
}
