import type { LayoutRun, PageGeometry } from "../parsing/layout.js";
import type { AstLine } from "../resume-ast/types.js";
import type { RenderBlock } from "../tailoring/tailor.js";
import { digest, pdfString, RenderError, type RenderedDocument, winAnsiCode } from "./pdf-text.js";
import { STANDARD_FONT_WIDTHS, type StandardFont } from "./standard-font-widths.js";

const MAX_BLOCKS = 2_000;
const MAX_PAGES = 10;
/** Source fonts are not available, so text is set in the nearest standard font, stretched to the
 * width it had. A stretch far from 1 would look wrong, so it is limited. */
const MIN_STRETCH = 0.7;
const MAX_STRETCH = 1.3;
/** Room below the lowest source line before another page is needed. */
const BOTTOM_ALLOWANCE = 12;

/** Blocks that can be drawn the way the candidate's resume was: every one has its source lines. */
export function canRenderStyled(
  blocks: readonly RenderBlock[],
  page: PageGeometry | undefined,
): page is PageGeometry {
  return (
    page !== undefined &&
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        block.lines !== undefined &&
        block.lines.length > 0 &&
        // Lines of a second column or sidebar read in an order that cannot be redrawn top to bottom;
        // they can only be edited in place on the candidate's own page.
        block.lines.every((line) => line.zone === undefined),
    )
  );
}

/** Whether every block still knows the source lines it came from, which an in-place edit needs. */
export function hasSourceLines(blocks: readonly RenderBlock[]): boolean {
  return (
    blocks.length > 0 &&
    blocks.every((block) => block.lines !== undefined && block.lines.length > 0)
  );
}

function fontOf(run: LayoutRun): StandardFont {
  const bold = run.bold === true;
  const italic = run.italic === true;
  if (run.family === "mono")
    return bold
      ? italic
        ? "Courier-BoldOblique"
        : "Courier-Bold"
      : italic
        ? "Courier-Oblique"
        : "Courier";
  if (run.family === "serif")
    return bold
      ? italic
        ? "Times-BoldItalic"
        : "Times-Bold"
      : italic
        ? "Times-Italic"
        : "Times-Roman";
  return bold
    ? italic
      ? "Helvetica-BoldOblique"
      : "Helvetica-Bold"
    : italic
      ? "Helvetica-Oblique"
      : "Helvetica";
}

function textWidth(text: string, font: StandardFont, size: number): number {
  let units = 0;
  const table = STANDARD_FONT_WIDTHS[font];
  for (const character of text) {
    const code = winAnsiCode(character);
    units += table ? (table[code - 32] ?? 0) : 600;
  }
  return (units * size) / 1000;
}

const number = (value: number) => String(Math.round(value * 100) / 100);

function color(value: string | undefined): string {
  const hex = value && /^#[0-9a-f]{6}$/u.test(value) ? value : "#000000";
  const channel = (offset: number) =>
    (Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(3);
  return `${channel(1)} ${channel(3)} ${channel(5)}`;
}

interface Placement {
  line: AstLine;
  y: number;
}

/**
 * Draws the tailored resume the way the candidate's own PDF was set: each kept source line keeps its
 * runs, sizes, left edge, colors, rules and the spacing it had after the line before it. Lines that
 * were left out simply close up; lines that were reordered take the spacing of the place they now
 * fill. Only the standard fonts are used, stretched to each run's source width, so the words and their
 * order are exactly the blocks' words.
 */
export function renderStyledPdf(
  blocks: readonly RenderBlock[],
  page: PageGeometry,
): RenderedDocument {
  if (blocks.length === 0) throw new RenderError("EMPTY_DOCUMENT");
  if (blocks.length > MAX_BLOCKS) throw new RenderError("TOO_LONG");
  const all = blocks.flatMap((block) => block.lines ?? []);
  const firstBaseline = all[0]?.y ?? 0;
  const lowest = Math.max(...all.map((line) => line.y));
  const limit = Math.min(page.height - 4, lowest + BOTTOM_ALLOWANCE);
  const ordinaryAdvance = (line: AstLine) => Math.max(...line.runs.map((run) => run.size)) * 1.3;

  const pages: Placement[][] = [[]];
  let previous: number | undefined;
  const place = (block: RenderBlock, from: number | undefined): Placement[] => {
    let y = from;
    const startOfDocument = pages.length === 1 && pages[0]?.length === 0;
    return (block.lines ?? []).map((line) => {
      y =
        y === undefined
          ? startOfDocument
            ? line.y
            : firstBaseline
          : y + (line.dy ?? ordinaryAdvance(line));
      return { line, y };
    });
  };
  blocks.forEach((block, index) => {
    const current = pages[pages.length - 1] ?? [];
    let placed = place(block, previous);
    // A heading or entry line stays with what follows it.
    const next = block.kind === "bullet" ? undefined : blocks[index + 1];
    const reach = (items: Placement[]) => {
      const last = items.at(-1);
      const following = next?.lines?.[0];
      return last ? last.y + (following ? (following.dy ?? ordinaryAdvance(following)) : 0) : 0;
    };
    if (current.length > 0 && reach(placed) > limit) {
      if (pages.length >= MAX_PAGES) throw new RenderError("TOO_LONG");
      pages.push([]);
      previous = undefined;
      placed = place(block, undefined);
    }
    (pages[pages.length - 1] ?? current).push(...placed);
    previous = placed.at(-1)?.y;
  });

  const fonts = new Map<StandardFont, string>();
  const fontName = (font: StandardFont) => {
    let name = fonts.get(font);
    if (!name) {
      name = `F${fonts.size + 1}`;
      fonts.set(font, name);
    }
    return name;
  };
  const streams = pages.map((items) => {
    const commands: string[] = [];
    for (const { line, y } of items) {
      for (const run of line.runs) {
        const font = fontOf(run);
        const natural = textWidth(run.text, font, run.size);
        const stretch =
          natural > 0 && run.w > 0
            ? Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, run.w / natural))
            : 1;
        commands.push(
          `BT /${fontName(font)} ${number(run.size)} Tf ${number(stretch * 100)} Tz ${color(run.color)} rg ${number(run.x)} ${number(page.height - y)} Td (${pdfString(run.text)}) Tj ET`,
        );
      }
      for (const rule of line.rules ?? []) {
        const top = y + rule.dy;
        commands.push(
          `${color(rule.color)} rg ${number(rule.x0)} ${number(page.height - top - rule.h)} ${number(rule.x1 - rule.x0)} ${number(rule.h)} re f`,
        );
      }
    }
    return commands.join("\n");
  });

  const objects: string[] = [];
  const firstFont = 3 + pages.length * 2;
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`,
  );
  const resources = `<< /Font << ${[...fonts.values()].map((name, index) => `/${name} ${firstFont + index} 0 R`).join(" ")} >> >>`;
  streams.forEach((stream, index) => {
    const pageNumber = 3 + index * 2;
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(page.width)} ${number(page.height)}] /Resources ${resources} /Contents ${pageNumber + 1} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${pageNumber + 1} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });
  [...fonts.keys()].forEach((font, index) => {
    objects.push(
      `${firstFont + index} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>\nendobj\n`,
    );
  });

  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source, "latin1"));
    source += object;
  }
  const xref = Buffer.byteLength(source, "latin1");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // A standalone copy: pooled Buffer slices confuse PDF.js, which reads the whole backing store.
  const bytes = Uint8Array.from(Buffer.from(source, "latin1"));
  return { mediaType: "application/pdf", bytes, sha256: digest(bytes), pageCount: pages.length };
}
