// Test-only. Builds the candidate's own PDF (a Google Docs style export with a marker rectangle) and the
// document parsed from it, so the image smoke can run the edit-in-place path. Synthetic files only.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parse, resumePdf } from "../../../services/documents/src/render/original/test-support.ts";

const directory = process.argv[2];
if (!directory) throw Error("SyntheticOriginalPdfTargetRejected");
const bytes = await resumePdf({ skia: true, marker: true });
const document = await parse(bytes);
writeFileSync(path.join(directory, "original.pdf"), bytes);
writeFileSync(path.join(directory, "document.json"), JSON.stringify(document));
