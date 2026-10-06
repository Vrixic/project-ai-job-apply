import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_LIMITS } from "./limits.js";
import { parsePdf } from "./pdf.js";

const mockedGetDocument = vi.hoisted(() => vi.fn());

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: mockedGetDocument }));

interface FakePdfDocument {
  isPureXfa: boolean;
  numPages: number;
  getAttachments: ReturnType<typeof vi.fn>;
  getJSActions: ReturnType<typeof vi.fn>;
  hasJSActions: ReturnType<typeof vi.fn>;
  getCalculationOrderIds: ReturnType<typeof vi.fn>;
  getPage: ReturnType<typeof vi.fn>;
}

function safeDocument(): FakePdfDocument {
  return {
    isPureXfa: false,
    numPages: 1,
    getAttachments: vi.fn().mockResolvedValue(null),
    getJSActions: vi.fn().mockResolvedValue(null),
    hasJSActions: vi.fn().mockResolvedValue(false),
    getCalculationOrderIds: vi.fn().mockResolvedValue(null),
    getPage: vi.fn().mockResolvedValue({
      getAnnotations: vi.fn().mockResolvedValue([]),
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "generated safe text", hasEOL: false }],
      }),
    }),
  };
}

const generatedPdfEnvelope = new TextEncoder().encode("%PDF-1.4\ngenerated\n%%EOF");
let document: FakePdfDocument;
let destroy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  Object.defineProperty(globalThis, "pdfjsWorker", {
    value: { WorkerMessageHandler: {} },
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  document = safeDocument();
  destroy = vi.fn().mockResolvedValue(undefined);
  mockedGetDocument.mockReset();
  mockedGetDocument.mockImplementation(() => ({
    promise: Promise.resolve(document),
    destroy,
  }));
});

describe("PDF post-parse security controls", () => {
  it("uses the isolated, non-executing pdfjs configuration and destroys the parser", async () => {
    await expect(parsePdf(generatedPdfEnvelope)).resolves.toEqual([
      { text: "generated safe text ", page: 1 },
    ]);
    expect(mockedGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        verbosity: 0,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        useWasm: false,
        stopAtErrors: true,
        maxImageSize: 1,
        enableXfa: false,
        isEvalSupported: false,
      }),
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("maps parser initialization failure to a stable rejection", async () => {
    mockedGetDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error("generated parser failure")),
      destroy,
    }));
    await expect(parsePdf(generatedPdfEnvelope)).rejects.toMatchObject({
      reasonCode: "PDF_PARSE_REJECTED",
    });
    expect(destroy).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "pure XFA",
      activate: (candidate: FakePdfDocument) => {
        candidate.isPureXfa = true;
      },
    },
    {
      name: "attachment map",
      activate: (candidate: FakePdfDocument) => {
        candidate.getAttachments.mockResolvedValue(new Map([["generated.txt", {}]]));
      },
    },
    {
      name: "document JavaScript actions",
      activate: (candidate: FakePdfDocument) => {
        candidate.getJSActions.mockResolvedValue({ generated: ["marker"] });
      },
    },
    {
      name: "JavaScript action flag",
      activate: (candidate: FakePdfDocument) => {
        candidate.hasJSActions.mockResolvedValue(true);
      },
    },
    {
      name: "calculation order",
      activate: (candidate: FakePdfDocument) => {
        candidate.getCalculationOrderIds.mockResolvedValue(["generated-field"]);
      },
    },
  ])("rejects parsed $name", async ({ activate }) => {
    activate(document);
    await expect(parsePdf(generatedPdfEnvelope)).rejects.toMatchObject({
      reasonCode: "PDF_ACTIVE_OR_EMBEDDED_CONTENT",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([0, DOCUMENT_LIMITS.pages + 1])("rejects a parsed page count of %i", async (numPages) => {
    document.numPages = numPages;
    await expect(parsePdf(generatedPdfEnvelope)).rejects.toMatchObject({
      reasonCode: "PDF_PAGE_LIMIT",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each(["action", "attachment", "file", "jsActions"] as const)(
    "rejects an annotation containing %s",
    async (unsafeField) => {
      document.getPage.mockResolvedValue({
        getAnnotations: vi.fn().mockResolvedValue([{ [unsafeField]: { generated: true } }]),
        getTextContent: vi.fn(),
      });
      await expect(parsePdf(generatedPdfEnvelope)).rejects.toMatchObject({
        reasonCode: "PDF_UNSAFE_ANNOTATION",
      });
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it("rejects a page over the text-item limit", async () => {
    document.getPage.mockResolvedValue({
      getAnnotations: vi.fn().mockResolvedValue([]),
      getTextContent: vi.fn().mockResolvedValue({
        items: Array.from({ length: DOCUMENT_LIMITS.pdfTextItems + 1 }, () => ({
          str: "x",
          hasEOL: false,
        })),
      }),
    });
    await expect(parsePdf(generatedPdfEnvelope)).rejects.toMatchObject({
      reasonCode: "PDF_TEXT_ITEM_LIMIT",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
