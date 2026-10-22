import { describe, expect, it } from "vitest";
import type { NormalizedResumeDocument } from "./parsing/normalize.js";
import { extractResumeDrafts } from "./resume-drafts.js";

function document(lines: string[]): NormalizedResumeDocument {
  let offset = 0;
  return {
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    version: 1,
    parserVersion: "synthetic-parser.v1",
    mediaType: "application/pdf",
    sourceSha256: "a".repeat(64),
    createdAt: "2026-10-22T12:00:00.000Z",
    blocks: lines.map((text, index) => {
      const block = { index, text, startOffset: offset, endOffset: offset + text.length };
      offset += text.length + 1;
      return block;
    }),
  };
}

const bySection = (drafts: ReturnType<typeof extractResumeDrafts>, section: string) =>
  drafts.filter((draft) => draft.section === section).map((draft) => draft.values);

describe("resume drafts (ADR-052, D3.1-006)", () => {
  it("extracts Personal, Education, Work experience and Skills from a conventional layout", () => {
    const drafts = extractResumeDrafts(
      document([
        "Jordan Example",
        "jordan@example.test | (555) 010-0100 | linkedin.com/in/jordan-example | github.com/jordan-example",
        "Experience",
        "Senior Software Engineer | Example Systems Inc | Jan 2020 - Present",
        "• Built a synthetic ingestion pipeline.",
        "• Led a team of five engineers.",
        "Software Engineer, Sample Labs, Jun 2017 - Dec 2019",
        "• Shipped a synthetic search feature.",
        "Education",
        "Example University",
        "Bachelor of Science in Computer Science, Sep 2013 - May 2017",
        "Skills",
        "Languages: TypeScript, Go; SQL",
        "• Kubernetes",
      ]),
    );
    expect(bySection(drafts, "personal")).toEqual([
      {
        fullName: "Jordan Example",
        email: "jordan@example.test",
        phone: "(555) 010-0100",
        links: [
          { kind: "linkedin", url: "https://linkedin.com/in/jordan-example" },
          { kind: "github", url: "https://github.com/jordan-example" },
        ],
      },
    ]);
    expect(bySection(drafts, "workExperience")).toEqual([
      {
        company: "Example Systems Inc",
        title: "Senior Software Engineer",
        startDate: "2020-01-01",
        bullets: ["Built a synthetic ingestion pipeline.", "Led a team of five engineers."],
      },
      {
        company: "Sample Labs",
        title: "Software Engineer",
        startDate: "2017-06-01",
        endDate: "2019-12-01",
        bullets: ["Shipped a synthetic search feature."],
      },
    ]);
    expect(bySection(drafts, "education")).toEqual([
      {
        school: "Example University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
        startDate: "2013-09-01",
        endDate: "2017-05-01",
      },
    ]);
    expect(bySection(drafts, "skill").map((skill) => skill.name)).toEqual([
      "TypeScript",
      "Go",
      "SQL",
      "Kubernetes",
    ]);
  });

  it("reads a company line above a date-only header and year-only ranges", () => {
    const drafts = extractResumeDrafts(
      document([
        "Work History",
        "Example Corp",
        "Data Analyst 2016 - 2018",
        "• Maintained synthetic dashboards.",
      ]),
    );
    expect(bySection(drafts, "workExperience")).toEqual([
      {
        company: "Example Corp",
        title: "Data Analyst",
        startDate: "2016-01-01",
        endDate: "2018-12-31",
        bullets: ["Maintained synthetic dashboards."],
      },
    ]);
  });

  it("skips an entry whose title or company cannot be read instead of guessing", () => {
    const drafts = extractResumeDrafts(
      document([
        "Experience",
        "Jan 2020 - Present",
        "• Did synthetic things.",
        "Mystery Blob Jan 2018 - Dec 2019",
        "Consulting | Freelance | 2015 - 2017",
      ]),
    );
    expect(bySection(drafts, "workExperience")).toEqual([]);
  });

  it("never invents values, personal data from the body, or restricted skills", () => {
    const drafts = extractResumeDrafts(
      document([
        "Experience",
        "Engineer | Example Co | Jan 2020 - Present",
        "• Contact the reviewer at reviewer@example.test for details.",
        "Skills",
        "Python, visa sponsorship, veteran status, Rust",
      ]),
    );
    expect(bySection(drafts, "personal")).toEqual([]);
    expect(bySection(drafts, "skill").map((skill) => skill.name)).toEqual(["Python", "Rust"]);
    expect(JSON.stringify(drafts)).not.toContain('reviewer@example.test"}');
  });

  it("handles inline skills, deduplicates and caps the output", () => {
    const many = Array.from({ length: 150 }, (_, i) => `Skill${i}`).join(", ");
    const drafts = extractResumeDrafts(
      document(["Skills: Python, python, Go", "Technical Skills", many]),
    );
    const names = bySection(drafts, "skill").map((skill) => skill.name);
    expect(names.slice(0, 2)).toContain("Python");
    expect(names.filter((name) => String(name).toLowerCase() === "python")).toHaveLength(1);
    expect(names).toHaveLength(100);
  });

  it("returns nothing for a document without recognizable structure", () => {
    expect(
      extractResumeDrafts(document(["Lorem ipsum dolor sit amet.", "No headings here."])),
    ).toEqual([]);
  });

  it("produces only values the profile contract accepts", async () => {
    const { compileComponentValidator } = await import("@ai-job-apply/api-contracts");
    const drafts = extractResumeDrafts(
      document([
        "Jordan Example",
        "jordan@example.test",
        "Experience",
        "Software Engineer | Example Systems | Mar 2019 - Present",
        "• Built a synthetic pipeline.",
        "Education",
        "Example University, B.S. in Mathematics, 2015 - 2019",
        "Skills",
        "TypeScript",
      ]),
    );
    expect(drafts.length).toBeGreaterThan(3);
    const validators = {
      personal: (values: object) =>
        compileComponentValidator("PutProfilePersonalRequest")({ expectedVersion: 0, ...values }),
      education: compileComponentValidator("CreateProfileEducationEntryRequest"),
      workExperience: compileComponentValidator("CreateProfileWorkExperienceEntryRequest"),
      skill: compileComponentValidator("CreateProfileSkillEntryRequest"),
    } as const;
    for (const draft of drafts) {
      expect(validators[draft.section](draft.values), JSON.stringify(draft)).toBe(true);
    }
  });
});
