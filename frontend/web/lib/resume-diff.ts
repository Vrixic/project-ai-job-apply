/**
 * Line-level comparison of the candidate's own resume with the tailored one. Pure and free of PDF.js so
 * it can be tested on its own: callers read both PDFs into `TextLine`s and draw the result.
 *
 * A line is "kept" when it survives in the same relative order, "moved" when the same text sits in a
 * different place, "changed" when most of its words survive but some were added or removed, "removed"
 * when it exists only in the original and "added" when it exists only in the tailored resume. A view
 * shows moved and added lines alike: both are lines that are new where they now stand.
 */

/** One line of text on a page, in PDF points with the origin at the top left of the page. */
export interface TextLine {
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  text: string;
}

export type OriginalStatus = "kept" | "moved" | "changed" | "removed";
export type TailoredStatus = "kept" | "moved" | "changed" | "added";

export interface WordChange {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface DiffLine<Status extends string> {
  line: TextLine;
  status: Status;
  /** Index of the same line on the other side, when there is one. */
  pair?: number;
  /** Word level changes, only for a changed line. */
  words?: WordChange[];
}

export interface ResumeDiffCounts {
  kept: number;
  moved: number;
  changed: number;
  removed: number;
  added: number;
}

export interface ResumeDiff {
  original: DiffLine<OriginalStatus>[];
  tailored: DiffLine<TailoredStatus>[];
  counts: ResumeDiffCounts;
}

/** Below this share of shared words two lines are different lines, not an edit of one. */
const SIMILARITY_THRESHOLD = 0.6;
/** Shorter lines only match when identical: a one or two word line cannot be "edited". */
const MINIMUM_WORDS_FOR_EDIT = 3;

export const lineKey = (text: string): string => text.replace(/\s+/gu, " ").trim();

const wordsOf = (text: string): string[] => lineKey(text).split(" ").filter(Boolean);

/** Longest common subsequence of two key lists, as pairs of indexes in increasing order. */
function commonSubsequence(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
}

/** Sørensen-Dice on word multisets: 1 for the same words, 0 for none in common. */
function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of b) {
    const left = counts.get(word) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(word, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** Word level changes between an original line and its edited counterpart. */
export function wordChanges(before: string, after: string): WordChange[] {
  const a = wordsOf(before);
  const b = wordsOf(after);
  const pairs = commonSubsequence(a, b);
  const changes: WordChange[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    for (; i < pi; i += 1) changes.push({ kind: "removed", text: a[i] ?? "" });
    for (; j < pj; j += 1) changes.push({ kind: "added", text: b[j] ?? "" });
    changes.push({ kind: "same", text: a[pi] ?? "" });
    i = pi + 1;
    j = pj + 1;
  }
  for (; i < a.length; i += 1) changes.push({ kind: "removed", text: a[i] ?? "" });
  for (; j < b.length; j += 1) changes.push({ kind: "added", text: b[j] ?? "" });
  return changes;
}

/** The lines that carry text, in the order given. The diff's indexes refer to this filtered list. */
export const textLinesOf = (lines: readonly TextLine[]): TextLine[] =>
  lines.filter((line) => lineKey(line.text) !== "");

export function diffResumeLines(
  originalLines: readonly TextLine[],
  tailoredLines: readonly TextLine[],
): ResumeDiff {
  const a = textLinesOf(originalLines);
  const b = textLinesOf(tailoredLines);
  const aKeys = a.map((line) => lineKey(line.text));
  const bKeys = b.map((line) => lineKey(line.text));
  const original: Array<DiffLine<OriginalStatus> | undefined> = new Array(a.length).fill(undefined);
  const tailored: Array<DiffLine<TailoredStatus> | undefined> = new Array(b.length).fill(undefined);
  const settle = (
    i: number,
    j: number,
    left: OriginalStatus,
    right: TailoredStatus,
    words?: WordChange[],
  ) => {
    original[i] = { line: a[i] as TextLine, status: left, pair: j, ...(words ? { words } : {}) };
    tailored[j] = { line: b[j] as TextLine, status: right, pair: i, ...(words ? { words } : {}) };
  };

  // 1. Same text, same relative order.
  for (const [i, j] of commonSubsequence(aKeys, bKeys)) settle(i, j, "kept", "kept");

  // 2. Same text somewhere else.
  const freeTailored = new Map<string, number[]>();
  tailored.forEach((entry, j) => {
    if (!entry)
      freeTailored.set(bKeys[j] as string, [...(freeTailored.get(bKeys[j] as string) ?? []), j]);
  });
  original.forEach((entry, i) => {
    if (entry) return;
    const candidates = freeTailored.get(aKeys[i] as string);
    const j = candidates?.shift();
    if (j !== undefined) settle(i, j, "moved", "moved");
  });

  // 3. Mostly the same words: an edited line.
  const candidates: Array<{ i: number; j: number; score: number }> = [];
  original.forEach((entry, i) => {
    if (entry) return;
    const left = wordsOf(aKeys[i] as string);
    if (left.length < MINIMUM_WORDS_FOR_EDIT) return;
    tailored.forEach((other, j) => {
      if (other) return;
      const right = wordsOf(bKeys[j] as string);
      if (right.length < MINIMUM_WORDS_FOR_EDIT) return;
      const score = similarity(left, right);
      if (score >= SIMILARITY_THRESHOLD) candidates.push({ i, j, score });
    });
  });
  candidates.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
  for (const { i, j } of candidates) {
    if (original[i] || tailored[j]) continue;
    settle(i, j, "changed", "changed", wordChanges(aKeys[i] as string, bKeys[j] as string));
  }

  // 4. Whatever is left exists on one side only.
  const finalOriginal = original.map(
    (entry, i) =>
      entry ?? ({ line: a[i] as TextLine, status: "removed" } as DiffLine<OriginalStatus>),
  );
  const finalTailored = tailored.map(
    (entry, j) =>
      entry ?? ({ line: b[j] as TextLine, status: "added" } as DiffLine<TailoredStatus>),
  );
  const counts: ResumeDiffCounts = { kept: 0, moved: 0, changed: 0, removed: 0, added: 0 };
  for (const entry of finalOriginal) {
    if (entry.status === "removed") counts.removed += 1;
    else if (entry.status === "kept") counts.kept += 1;
    else if (entry.status === "moved") counts.moved += 1;
    else counts.changed += 1;
  }
  for (const entry of finalTailored) if (entry.status === "added") counts.added += 1;
  return { original: finalOriginal, tailored: finalTailored, counts };
}

/** Where lines were cut: a point on a tailored page, and the text of what was taken out there. */
export interface RemovalPoint {
  /** The tailored page, from 1. */
  page: number;
  /** Distance from the top of that page in PDF points: the gap between two tailored lines. */
  top: number;
  /** The removed lines in their original order. Consecutive removals share one point. */
  texts: string[];
}

/** A line that kept its place, or was only edited: it marks where its neighbours were. */
const isStable = (status: OriginalStatus): boolean => status === "kept" || status === "changed";

/**
 * Where on the tailored resume each run of removed lines used to sit. A removed line has no place
 * there, so it is put just below the nearest earlier original line that stayed in place (moved lines
 * are no anchor: they are somewhere else), or just above the first one that did when nothing earlier
 * stayed. A resume in which nothing stayed has no place to point to, so its points go to the top of
 * the first page.
 */
export function removalPoints(diff: ResumeDiff): RemovalPoint[] {
  const points: RemovalPoint[] = [];
  const anchorOf = (index: number): { line: TextLine; below: boolean } | undefined => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const entry = diff.original[i];
      const pair = entry && isStable(entry.status) ? entry.pair : undefined;
      const tailored = pair === undefined ? undefined : diff.tailored[pair];
      if (tailored) return { line: tailored.line, below: true };
    }
    for (let i = index + 1; i < diff.original.length; i += 1) {
      const entry = diff.original[i];
      const pair = entry && isStable(entry.status) ? entry.pair : undefined;
      const tailored = pair === undefined ? undefined : diff.tailored[pair];
      if (tailored) return { line: tailored.line, below: false };
    }
    return undefined;
  };
  let run: RemovalPoint | undefined;
  diff.original.forEach((entry, index) => {
    if (entry.status !== "removed") {
      run = undefined;
      return;
    }
    if (run) {
      run.texts.push(lineKey(entry.line.text));
      return;
    }
    const anchor = anchorOf(index);
    run = {
      page: anchor ? anchor.line.page : 1,
      top: anchor
        ? anchor.below
          ? anchor.line.top + anchor.line.height + 1
          : Math.max(anchor.line.top - 1, 0)
        : 0,
      texts: [lineKey(entry.line.text)],
    };
    points.push(run);
  });
  return points;
}
