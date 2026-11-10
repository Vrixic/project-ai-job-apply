import type { TextLine } from "./resume-diff";

/** The part of a PDF.js text item this module reads. */
export interface PdfTextItem {
  str: string;
  /** PDF.js transform: [a, b, c, d, x, y] with the origin at the bottom left of the page. */
  transform: readonly number[];
  width: number;
  height: number;
}

/** Items closer than this share a line (as a share of the larger font size). */
const SAME_LINE = 0.4;
/** A gap wider than this many font sizes starts a new line: a column, a tab stop or a right-aligned date. */
const COLUMN_BREAK = 2.5;
/** A gap wider than this share of the font size is a space between words. */
const WORD_GAP = 0.15;

interface Placed {
  text: string;
  x: number;
  baseline: number;
  width: number;
  size: number;
}

function place(item: PdfTextItem): Placed | undefined {
  if (item.str.trim() === "") return undefined;
  const x = item.transform[4];
  const baseline = item.transform[5];
  if (x === undefined || baseline === undefined) return undefined;
  const size =
    item.height > 0 ? item.height : Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0);
  return { text: item.str, x, baseline, width: item.width, size: size > 0 ? size : 10 };
}

/**
 * Groups the text items of one page into lines of text. A page whose items share a baseline but sit far
 * apart (columns, a date at the right margin) yields one line per run, so each can be marked on its own.
 */
export function linesFromTextItems(
  items: readonly PdfTextItem[],
  page: number,
  pageHeight: number,
): TextLine[] {
  const placed = items.map(place).filter((item): item is Placed => item !== undefined);
  placed.sort((a, b) => b.baseline - a.baseline || a.x - b.x);

  const rows: Placed[][] = [];
  for (const item of placed) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (
      row &&
      first &&
      Math.abs(first.baseline - item.baseline) <= SAME_LINE * Math.max(first.size, item.size)
    )
      row.push(item);
    else rows.push([item]);
  }

  const lines: TextLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let run: Placed[] = [];
    const flush = () => {
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last) return;
      let text = "";
      let previous: Placed | undefined;
      for (const item of run) {
        if (previous) {
          const gap = item.x - (previous.x + previous.width);
          const spaced = /\s$/u.test(previous.text) || /^\s/u.test(item.text);
          if (!spaced && gap > WORD_GAP * Math.max(previous.size, item.size)) text += " ";
        }
        text += item.text;
        previous = item;
      }
      const size = Math.max(...run.map((item) => item.size));
      lines.push({
        page,
        x: first.x,
        top: pageHeight - (first.baseline + size),
        width: Math.max(last.x + last.width - first.x, 1),
        height: size * 1.25,
        text,
      });
      run = [];
    };
    for (const item of row) {
      const previous = run[run.length - 1];
      if (
        previous &&
        item.x - (previous.x + previous.width) > COLUMN_BREAK * Math.max(previous.size, item.size)
      )
        flush();
      run.push(item);
    }
    flush();
  }
  return lines;
}

/** The structural slice of PDF.js's document proxy that `extractTextLines` uses. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(number: number): Promise<{
    getViewport(options: { scale: number }): { height: number };
    getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
  }>;
}

const isTextItem = (value: unknown): value is PdfTextItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PdfTextItem).str === "string" &&
  Array.isArray((value as PdfTextItem).transform);

/** Every line of text of every page, in reading order from the top of page one. */
export async function extractTextLines(document: PdfDocumentLike): Promise<TextLine[]> {
  const lines: TextLine[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    lines.push(...linesFromTextItems(content.items.filter(isTextItem), number, height));
  }
  return lines;
}
