import { describe, expect, it } from "vitest";
import { resumeFileName } from "./resume-file-name";

const ID = "01a160f2-cd42-75b0-a7e5-4cb30d5f42be";

describe("resumeFileName", () => {
  it("is User_Job_Name_ID with a pdf extension", () => {
    expect(
      resumeFileName({
        candidateName: "Vrij Patel",
        jobTitle: "Software Engineer, Graphics",
        applicationId: ID,
      }),
    ).toBe(`Vrij_Patel_Software_Engineer_Graphics_${ID}.pdf`);
  });

  it("folds accents and drops path and punctuation characters", () => {
    const name = resumeFileName({
      candidateName: "José Núñez",
      jobTitle: "../C++ / C# Dev: \\Games?",
      applicationId: ID,
    });
    expect(name).toBe(`Jose_Nunez_C_C_Dev_Games_${ID}.pdf`);
    expect(name).toMatch(/^[\p{L}\p{N}_.-]+$/u);
  });

  it("keeps only the local part of an email used as the account name", () => {
    expect(
      resumeFileName({
        candidateName: "vrij.ptl21@gmail.com",
        jobTitle: "Engineer",
        applicationId: ID,
      }),
    ).toBe(`vrij_ptl21_Engineer_${ID}.pdf`);
  });

  it("falls back when the name or the job title is unknown", () => {
    expect(resumeFileName({ applicationId: ID })).toBe(`Candidate_Job_${ID}.pdf`);
    expect(resumeFileName({ candidateName: "  ", jobTitle: "???", applicationId: ID })).toBe(
      `Candidate_Job_${ID}.pdf`,
    );
  });

  it("shortens only the job title when the name would run long", () => {
    const name = resumeFileName({
      candidateName: "Vrij Patel",
      jobTitle: "Principal Staff Senior Graphics Rendering Performance Engineer ".repeat(5),
      applicationId: ID,
    });
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.startsWith("Vrij_Patel_Principal_Staff")).toBe(true);
    expect(name.endsWith(`_${ID}.pdf`)).toBe(true);
  });
});
