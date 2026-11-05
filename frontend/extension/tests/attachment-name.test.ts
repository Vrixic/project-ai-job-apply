import { validateApplicationExecutionCommand } from "@ai-job-apply/api-contracts/browser-validators";
import { describe, expect, it } from "vitest";
import { attachmentName } from "../lib/attachment-name";

const resume = (firstName?: string, lastName?: string, jobTitle?: string) =>
  attachmentName({ kind: "tailored_resume", firstName, lastName, jobTitle, format: "pdf" });

describe("attachmentName", () => {
  it("is the first name, last name and job title", () => {
    expect(resume("Vrij", "Patel", "Software Engineer")).toBe("Vrij_Patel_Software_Engineer.pdf");
  });
  it("folds accents and collapses punctuation", () => {
    expect(resume("José", "O'Brien-Núñez", "Sr. Engineer (Platform) / Remote")).toBe(
      "Jose_O_Brien_Nunez_Sr_Engineer_Platform_Remote.pdf",
    );
  });
  it("never carries the old generic names", () => {
    expect(resume("A", "B", "C")).not.toContain("tailored_resume");
    expect(resume(undefined, undefined, undefined)).toBe("Candidate.pdf");
  });
  it("names a cover letter and keeps the file format", () => {
    expect(
      attachmentName({
        kind: "cover_letter",
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "X",
        format: "pdf",
      }),
    ).toBe("Ada_Lovelace_Cover_Letter.pdf");
    expect(
      attachmentName({
        kind: "uploaded_resume",
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Analyst",
        format: "docx",
      }),
    ).toBe("Ada_Lovelace_Analyst.docx");
  });
  it("stays within the command's file name pattern, however long the title", () => {
    const name = resume(
      "Vrij",
      "Patel",
      "Principal Staff Distinguished Software Engineer ".repeat(10),
    );
    expect(name.length).toBeLessThanOrEqual(100);
    const command = {
      schema: "application-execution-command.v1",
      nonce: "a".repeat(64),
      attemptId: "00000000-0000-7000-8000-000000000002",
      documentId: "0123456789abcdef0123456789abcdef",
      employerUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      packetHash: "b".repeat(64),
      formHash: "c".repeat(64),
      variantId: "v",
      adapterVersion: "1",
      deadline: Date.now() + 1000,
      fields: [],
      files: [
        {
          kind: "tailored_resume",
          generationId: "00000000-0000-7000-8000-000000000003",
          fileName: name,
          format: "pdf",
          mediaType: "application/pdf",
          sha256: "d".repeat(64),
          contentBase64: "JVBERi0=",
        },
      ],
    };
    expect(validateApplicationExecutionCommand(command)).toBe(true);
    const [file] = command.files;
    expect(
      validateApplicationExecutionCommand({
        ...command,
        files: [{ ...file, fileName: "tailored resume.pdf" }],
      }),
    ).toBe(false);
  });
});
