import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(repositoryRoot, "backend/services/documents/dist/lambda");
const packageFilter = "@ai-job-apply/documents-service...";

function minimalPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source));
    source += object;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

const coordinator = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/services/documents/dist/src/processor-lambda.js"),
  outputDirectory,
  artifactName: "document-processor-lambda",
  applicationName: "@ai-job-apply/document-processor-lambda",
  handlers: ["index.handler"],
  packageFilter,
});
const parser = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/services/documents/dist/src/parser-lambda.js"),
  outputDirectory,
  artifactName: "document-parser-lambda",
  applicationName: "@ai-job-apply/document-parser-lambda",
  handlers: ["index.handler"],
  packageFilter,
  verifyBundle: async (bundleModule) => {
    if (typeof bundleModule.verifyBundledPdfParser !== "function") {
      throw new Error("The document parser bundle does not export its PDF verification hook");
    }
    await bundleModule.verifyBundledPdfParser(
      new Uint8Array(minimalPdf("Bundled parser verification")),
    );
  },
});

process.stdout.write(`${JSON.stringify({ coordinator, parser })}\n`);
