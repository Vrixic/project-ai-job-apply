import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { parseResume } from "../../parsing/index.js";

/** A synthetic resume PDF written the way a word processor writes one, for the in-place editor tests. */

interface Line {
  text: string;
  x: number;
  /** Baseline measured from the top of the page. */
  top: number;
  size: number;
  bold?: boolean;
  /** Fill color, as the three components of `rg`. */
  color?: readonly [number, number, number];
  link?: string;
}

export const PAGE = { width: 612, height: 792 };
const RED = [0.8, 0, 0] as const;

const lines: Line[] = [
  { text: "Alex Example", x: 200, top: 60, size: 24, bold: true },
  { text: "Projects", x: 36, top: 110, size: 18, bold: true, color: RED },
  { text: "Liberator - Programmer", x: 36, top: 140, size: 12, bold: true },
  { text: "\\225 Wrote tools for the art team", x: 36, top: 160, size: 12 },
  {
    text: "\\225 Built a Vulkan renderer with shader reloading",
    x: 36,
    top: 178,
    size: 12,
    link: "https://example.com/renderer",
  },
  { text: "\\225 Mentored two engineers", x: 36, top: 196, size: 12 },
];

const pdfEscape = (value: string) => value.replaceAll("(", "\\(").replaceAll(")", "\\)");

/**
 * A resume the way a word processor writes one: every line of text in its own `q ... Q`, a rule under
 * the heading in its own block and a second rule drawn loose, real fonts and one link.
 */
export async function resumePdf(
  options: { compress?: boolean; formXObjectText?: boolean; scriptLink?: boolean } = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE.width, PAGE.height]);
  const body: string[] = [];
  for (const line of lines) {
    const y = PAGE.height - line.top;
    const color = line.color ? `${line.color.join(" ")} rg\n` : "0 g\n";
    body.push(
      `q\nBT\n/${line.bold ? "F2" : "F1"} ${line.size} Tf\n${color}1 0 0 1 ${line.x} ${y} Tm\n(${line.text.startsWith("\\225") ? line.text : pdfEscape(line.text)}) Tj\nET\nQ`,
    );
    if (line.text === "Projects") body.push(`q\n0.6 w\n36 ${y - 6} m\n576 ${y - 6} l\nS\nQ`);
  }
  // A thin rule drawn outside any q ... Q, as some exporters do.
  body.push(`0.5 g\n36 ${PAGE.height - 80} 540 0.8 re\nf*`);
  if (options.formXObjectText) {
    const form = document.context.stream("BT /F1 12 Tf 1 0 0 1 36 300 Tm (hidden) Tj ET", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 612, 792],
      Resources: { Font: { F1: regular.ref } },
    });
    page.node.set(
      PDFName.of("Resources"),
      document.context.obj({
        Font: { F1: regular.ref, F2: bold.ref },
        XObject: { Fm0: document.context.register(form) },
      }),
    );
    body.push("q\n/Fm0 Do\nQ");
  } else {
    page.node.set(
      PDFName.of("Resources"),
      document.context.obj({ Font: { F1: regular.ref, F2: bold.ref } }),
    );
  }
  const stream = body.join("\n");
  page.node.set(
    PDFName.of("Contents"),
    document.context.register(
      options.compress === false
        ? document.context.stream(stream)
        : document.context.flateStream(stream),
    ),
  );
  const annotations = lines.flatMap((line) =>
    line.link
      ? [
          document.context.register(
            document.context.obj({
              Type: "Annot",
              Subtype: "Link",
              Rect: [
                line.x,
                PAGE.height - line.top - 3,
                line.x + 260,
                PAGE.height - line.top + line.size,
              ],
              Border: [0, 0, 0],
              A: { Type: "Action", S: "URI", URI: PDFString.of(line.link) },
            }),
          ),
        ]
      : [],
  );
  if (options.scriptLink)
    annotations.push(
      document.context.register(
        document.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [36, 100, 200, 120],
          A: { Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") },
        }),
      ),
    );
  page.node.set(PDFName.of("Annots"), document.context.obj(annotations));
  return Uint8Array.from(await document.save({ useObjectStreams: false }));
}

export async function parse(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return parseResume({
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    documentVersion: 1,
    parserVersion: "original-edit-test",
    mediaType: "application/pdf",
    sourceSha256: createHash("sha256").update(copy).digest("hex"),
    createdAt: "2026-01-01T00:00:00.000Z",
    bytes: copy,
  });
}

export const runsByText = async (bytes: Uint8Array) => {
  const document = await parse(bytes);
  const found = new Map<
    string,
    { x: number; size: number; bold?: boolean; color?: string; y: number }
  >();
  for (const block of document.blocks) {
    if (!block.layout) continue;
    for (const run of block.layout.runs) {
      found.set(run.text, {
        x: run.x,
        size: run.size,
        ...(run.bold ? { bold: true } : {}),
        ...(run.color ? { color: run.color } : {}),
        y: block.layout.y,
      });
    }
  }
  return found;
};

export const linksOf = async (bytes: Uint8Array) => {
  const document = await PDFDocument.load(bytes);
  return document.getPages().flatMap((page) => {
    const annotations = page.node.Annots();
    if (!annotations) return [];
    return annotations.asArray().flatMap((ref) => {
      const annotation = page.doc.context.lookup(ref, PDFDict);
      const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
      const uri = action?.get(PDFName.of("URI"));
      const rect = annotation.lookup(PDFName.of("Rect"), PDFArray).asArray();
      return [
        {
          uri: uri instanceof PDFString ? uri.decodeText() : undefined,
          rectY: Number(rect[1]?.toString()),
        },
      ];
    });
  });
};
