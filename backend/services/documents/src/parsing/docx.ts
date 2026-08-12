import { SaxesParser } from "saxes";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { DOCUMENT_LIMITS, InvalidDocumentError, ParseLimitError } from "./limits.js";
import type { ParsedTextBlock } from "./normalize.js";

const allowedWordPart = /^word\/(?:document|footnotes|endnotes|header[0-9]+|footer[0-9]+)\.xml$/u;
const forbiddenPart = /(?:\.bin$|vbaProject|embeddings\/|altChunk|oleObject|\.exe$|\.js$)/iu;

function openZip(bytes: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, autoClose: false },
      (error, zip) => {
        if (error || !zip) reject(new InvalidDocumentError("DOCX_ZIP_REJECTED"));
        else resolve(zip);
      },
    );
  });
}

function readEntry(zip: ZipFile, entry: Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new InvalidDocumentError("DOCX_ENTRY_READ"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > DOCUMENT_LIMITS.zipEntryBytes) stream.destroy(new Error("entry limit"));
        else chunks.push(chunk);
      });
      stream.once("error", () => reject(new ParseLimitError("DOCX_ENTRY_LIMIT")));
      stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  });
}

function textBlocksFromWordXml(xml: string): ParsedTextBlock[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new InvalidDocumentError("DOCX_DTD_OR_ENTITY");
  }
  const blocks: ParsedTextBlock[] = [];
  let paragraphDepth = 0;
  let depth = 0;
  let text = "";
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > DOCUMENT_LIMITS.xmlDepth) throw new ParseLimitError("DOCX_XML_DEPTH");
    if (tag.name === "w:p" || tag.name === "p") {
      paragraphDepth += 1;
      if (paragraphDepth === 1) text = "";
    }
    if (tag.name === "w:tab" || tag.name === "tab") text += " ";
    if (tag.name === "w:br" || tag.name === "br") text += "\n";
  });
  parser.on("text", (value) => {
    if (paragraphDepth > 0) text += value;
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "w:p" || tag.name === "p") {
      if (paragraphDepth === 1) blocks.push({ text });
      paragraphDepth -= 1;
    }
    depth -= 1;
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof ParseLimitError || error instanceof InvalidDocumentError) throw error;
    throw new InvalidDocumentError("DOCX_XML_REJECTED");
  }
  return blocks;
}

export async function parseDocx(bytes: Uint8Array): Promise<ParsedTextBlock[]> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new InvalidDocumentError("DOCX_MAGIC");
  }
  const zip = await openZip(bytes);
  const names = new Set<string>();
  const xmlParts: Array<{ entry: Entry; name: string }> = [];
  const relationshipParts: Array<{ entry: Entry; name: string }> = [];
  let entries = 0;
  let totalUncompressed = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("entry", (entry: Entry) => {
        try {
          entries += 1;
          if (entries > DOCUMENT_LIMITS.zipEntries) throw new ParseLimitError("DOCX_ENTRY_COUNT");
          const name = entry.fileName.replaceAll("\\", "/");
          if (name.startsWith("/") || name.split("/").includes("..") || names.has(name)) {
            throw new InvalidDocumentError("DOCX_PATH_OR_DUPLICATE");
          }
          names.add(name);
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            throw new InvalidDocumentError("DOCX_ENCRYPTED_ENTRY");
          }
          if (forbiddenPart.test(name)) throw new InvalidDocumentError("DOCX_ACTIVE_CONTENT");
          if (entry.uncompressedSize > DOCUMENT_LIMITS.zipEntryBytes) {
            throw new ParseLimitError("DOCX_ENTRY_LIMIT");
          }
          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > DOCUMENT_LIMITS.zipTotalBytes) {
            throw new ParseLimitError("DOCX_TOTAL_INFLATION_LIMIT");
          }
          if (
            entry.compressedSize > 0 &&
            entry.uncompressedSize / entry.compressedSize > DOCUMENT_LIMITS.zipCompressionRatio
          ) {
            throw new ParseLimitError("DOCX_COMPRESSION_RATIO");
          }
          if (name.endsWith(".zip")) throw new InvalidDocumentError("DOCX_NESTED_ARCHIVE");
          if (allowedWordPart.test(name)) xmlParts.push({ entry, name });
          if (name.endsWith(".rels")) relationshipParts.push({ entry, name });
          zip.readEntry();
        } catch (error) {
          reject(error);
          zip.close();
        }
      });
      zip.once("end", resolve);
      zip.once("error", () => reject(new InvalidDocumentError("DOCX_ZIP_REJECTED")));
      zip.readEntry();
    });
    if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
      throw new InvalidDocumentError("DOCX_REQUIRED_PARTS");
    }
    for (const part of relationshipParts) {
      const relationships = await readEntry(zip, part.entry);
      if (/<!DOCTYPE|<!ENTITY/iu.test(relationships)) {
        throw new InvalidDocumentError("DOCX_DTD_OR_ENTITY");
      }
      if (/TargetMode\s*=\s*["']External["']/iu.test(relationships)) {
        throw new InvalidDocumentError("DOCX_EXTERNAL_RELATIONSHIP");
      }
    }
    const blocks: ParsedTextBlock[] = [];
    for (const part of xmlParts.sort((left, right) => left.name.localeCompare(right.name))) {
      blocks.push(...textBlocksFromWordXml(await readEntry(zip, part.entry)));
    }
    return blocks;
  } finally {
    zip.close();
  }
}
