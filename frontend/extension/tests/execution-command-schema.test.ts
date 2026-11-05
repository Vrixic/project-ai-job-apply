import { validateApplicationExecutionCommand } from "@ai-job-apply/api-contracts/browser-validators";
import { describe, expect, it } from "vitest";

const command = (documentId: string) => ({
  schema: "application-execution-command.v1",
  nonce: "a".repeat(64),
  attemptId: "00000000-0000-7000-8000-000000000002",
  documentId,
  employerUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
  packetHash: "b".repeat(64),
  formHash: "c".repeat(64),
  variantId: "greenhouse-standard-v1",
  adapterVersion: "1.0.0",
  deadline: Date.now() + 50_000,
  fillOnly: true,
  fields: [
    { fieldKey: "contact.email", value: "synthetic@example.invalid", needsUserAction: false },
  ],
  files: [
    {
      kind: "tailored_resume",
      generationId: "00000000-0000-7000-8000-000000000003",
      format: "pdf",
      mediaType: "application/pdf",
      sha256: "d".repeat(64),
      contentBase64: "JVBERi0=",
    },
  ],
});

describe("the execution command", () => {
  it("accepts the document id Chrome reports (32 hex characters) and a UUID", () => {
    expect(validateApplicationExecutionCommand(command("0123456789ABCDEF0123456789abcdef"))).toBe(
      true,
    );
    expect(
      validateApplicationExecutionCommand(command("00000000-0000-7000-8000-000000000007")),
    ).toBe(true);
  });
  it("refuses anything else as a document id", () => {
    for (const id of ["", "not-an-id", "0123456789abcdef0123456789abcde", "g".repeat(32)])
      expect(validateApplicationExecutionCommand(command(id))).toBe(false);
  });
});
