import { readFile, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const contract = JSON.parse(await readFile(new URL("openapi/platform.v1.json", root), "utf8"));
const schemas = JSON.parse(
  JSON.stringify(contract.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
);
const names = [
  "Application",
  "StartApplicationSubmissionRequest",
  "ApplicationSubmissionStart",
  "ApplicationAttempt",
  "ApplicationSubmissionResultRequest",
  "ApplicationExecutionInspect",
  "ApplicationExecutionInspection",
  "ApplicationExecutionCommand",
  "ApplicationExecutionProof",
  "ApplicationExecutionProofResult",
  "ApplicationExecutionResult",
  "ApplicationExecutionCancel",
  "CanonicalJobDetail",
  "ApplicationTemporaryMaterialAuthorization",
  "ApplicationResumeFile",
  "ApplicationCoverLetterFile",
  "ApplicationNativeTransferBegin",
  "ApplicationNativeTransferAdmission",
  "ApplicationNativeTransferCommit",
  "ApplicationNativeTransferReceipt",
  "ApplicationNativeTransferDiscard",
  "ApplicationNativeTransferCancel",
];
const ajv = new Ajv2020({ strict: true, allErrors: false, code: { source: true } });
addFormats(ajv);
for (const name of names) {
  ajv.addSchema({ $ref: `#/$defs/${name}`, $defs: schemas }, name);
}
await writeFile(
  new URL("generated/browser-validators.cjs", root),
  `// Generated from platform.v1.json; do not edit. No runtime schema compilation.\n${standalone(ajv, Object.fromEntries(names.map((name) => [`validate${name}`, name])))}`,
);
await writeFile(
  new URL("generated/browser-validators.d.ts", root),
  `// Generated; do not edit.\nimport type { ${names.join(", ")} } from "../src/index.js";\n${names.map((name) => `export function validate${name}(value: unknown): value is ${name};`).join("\n")}\n`,
);
