import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_RESUME, syntheticDocument } from "./resume-ast/test-support.js";
import {
  createResumeTailoringService,
  type ParsedResumeRecord,
  type ParsedResumeSource,
  parseResumeTailoringRequest,
  RESUME_TAILORING_REQUEST_KIND,
  RESUME_TAILORING_RESULT_SCHEMA,
} from "./resume-tailoring.js";

const OWNER = "019d04cf-1f80-7000-8000-0000000000a1";
const OTHER = "019d04cf-1f80-7000-8000-0000000000a2";
const DOCUMENT = "019d04cf-1f80-7000-8000-000000000001";

const record: ParsedResumeRecord = {
  id: DOCUMENT,
  version: 1,
  fileName: "synthetic-resume.pdf",
  mediaType: "application/pdf",
  sizeBytes: 1200,
  sha256: "a".repeat(64),
  sourceObjectKey: `quarantine/${DOCUMENT}/source`,
  sourceObjectVersion: "v1",
  parserVersion: "synthetic-parser-1",
  normalizedObjectKey: `normalized/${DOCUMENT}/${"a".repeat(64)}/synthetic-parser-1/resume.json`,
  normalizedObjectVersion: "nv1",
  normalizedSha256: "b".repeat(64),
  pageCount: 1,
  characterCount: 400,
  createdAt: "2026-09-18T12:00:00.000Z",
};

const job = {
  title: "Senior Backend Engineer",
  description: "Build reliable payments APIs in TypeScript with PostgreSQL.",
};

function serviceFor(options: { owned?: ParsedResumeRecord | null; readerFails?: boolean } = {}) {
  const lookups: Array<{ owner: string; documentId?: string }> = [];
  const source: ParsedResumeSource = {
    async findParsedResume(ownerUserId, documentId) {
      lookups.push({ owner: ownerUserId, ...(documentId ? { documentId } : {}) });
      return ownerUserId === OWNER && options.owned !== null ? (options.owned ?? record) : null;
    },
  };
  const service = createResumeTailoringService({
    source,
    reader: {
      async read() {
        if (options.readerFails) throw new Error("NormalizedObjectDigestInvalid");
        return syntheticDocument(SYNTHETIC_RESUME);
      },
    },
  });
  return { service, lookups };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    kind: RESUME_TAILORING_REQUEST_KIND,
    mode: "preview",
    ownerUserId: OWNER,
    job,
    ...overrides,
  };
}

describe("parseResumeTailoringRequest", () => {
  it("accepts the three modes and rejects everything else", () => {
    expect(parseResumeTailoringRequest(request({ mode: "hash" }))).not.toBeNull();
    expect(
      parseResumeTailoringRequest(request({ mode: "artifact", format: "pdf" })),
    ).not.toBeNull();
    for (const bad of [
      null,
      "x",
      [],
      request({ kind: "other" }),
      request({ mode: "everything" }),
      request({ ownerUserId: "not-a-uuid" }),
      request({ documentId: "nope" }),
      request({ extra: true }),
      request({ job: { title: "", description: "" } }),
      request({ job: { title: "t", description: "x".repeat(60_001) } }),
      request({ job: { title: "t", description: "d", url: "https://x" } }),
      request({ mode: "artifact" }),
      request({ mode: "preview", format: "pdf" }),
      request({ mode: "artifact", format: "exe" }),
    ]) {
      expect(parseResumeTailoringRequest(bad)).toBeNull();
    }
  });
});

describe("resume tailoring service", () => {
  it("returns only the base identity and a stable content hash in hash mode", async () => {
    const { service } = serviceFor();
    const first = await service(request({ mode: "hash" }));
    const second = await service(request({ mode: "hash" }));
    expect(first).toMatchObject({
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "ready",
      baseDocument: { id: DOCUMENT, fileName: "synthetic-resume.pdf", sha256: "a".repeat(64) },
      tailoringVersion: "tailoring.v1",
    });
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty("sections");
    expect(first).not.toHaveProperty("artifact");
    if (first.status !== "ready") throw new Error("expected ready");
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("changes the content hash only when the job text changes the resulting resume", async () => {
    const { service } = serviceFor();
    const payments = {
      title: "Payments Engineer",
      description: "Payments API TypeScript partners.",
    };
    const deploys = {
      title: "Release Engineer",
      description: "Deploy time minutes deploy pipelines.",
    };
    const a = await service(request({ mode: "hash", job: payments }));
    const b = await service(request({ mode: "hash", job: deploys }));
    const same = await service(
      request({ mode: "hash", job: { ...payments, description: `${payments.description} Also.` } }),
    );
    if (a.status !== "ready" || b.status !== "ready" || same.status !== "ready") {
      throw new Error("expected ready");
    }
    // Different emphasis reorders the bullets, so the approved artifact changes.
    expect(a.contentSha256).not.toBe(b.contentSha256);
    // A wording change that leaves the resulting resume identical does not expire approval.
    expect(same.contentSha256).toBe(a.contentSha256);
  });

  it("shows what changed, section by section, with fixed labels and only the candidate's own text", async () => {
    const { service } = serviceFor();
    const result = await service(request());
    if (result.status !== "ready") throw new Error("expected ready");
    const experience = result.sections?.find((section) => section.kind === "experience");
    expect(experience?.heading).toBe("Experience");
    const bullets = experience?.entries.flatMap((entry) => entry.bullets) ?? [];
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      expect(["kept", "moved_up", "omitted"]).toContain(bullet.change);
      expect(SYNTHETIC_RESUME.some((line) => line.endsWith(bullet.text))).toBe(true);
    }
    expect(result.matchedTerms).toEqual(expect.arrayContaining(["typescript", "postgresql"]));
    expect(result.matchedTerms).not.toContain("kubernetes-cluster-wishlist");
  });

  it("renders and verifies a PDF, and never returns an unverified artifact", async () => {
    const { service } = serviceFor();
    const result = await service(request({ mode: "artifact", format: "pdf" }));
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.artifact?.format).toBe("pdf");
    expect(result.artifact?.mediaType).toBe("application/pdf");
    expect(result.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const artifactBytes = Buffer.from(result.artifact?.contentBase64 ?? "", "base64");
    expect(artifactBytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(artifactBytes.subarray(0, 5))).toBe("%PDF-");
    expect(createHash("sha256").update(artifactBytes).digest("hex")).toBe(result.artifact?.sha256);
    expect(artifactBytes.byteLength).toBe(result.artifact?.sizeBytes);
  });

  it("delivers generated resumes only as PDF: a Word request is invalid", async () => {
    const { service } = serviceFor();
    expect(await service(request({ mode: "artifact", format: "docx" as never }))).toEqual({
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "unavailable",
      reason: "invalid_request",
    });
  });

  it("reports no resume for an owner without a parsed resume and never reads another owner's", async () => {
    const { service, lookups } = serviceFor();
    expect(await service(request({ ownerUserId: OTHER }))).toEqual({
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "no_resume",
    });
    expect(lookups).toEqual([{ owner: OTHER }]);
    const none = serviceFor({ owned: null });
    expect(await none.service(request())).toMatchObject({ status: "no_resume" });
  });

  it("passes the requested document id to the owner-scoped lookup", async () => {
    const { service, lookups } = serviceFor();
    await service(request({ mode: "hash", documentId: DOCUMENT }));
    expect(lookups).toEqual([{ owner: OWNER, documentId: DOCUMENT }]);
  });

  it("fails closed with a fixed reason and no text for an invalid request or unreadable document", async () => {
    const { service } = serviceFor();
    expect(await service({ kind: RESUME_TAILORING_REQUEST_KIND })).toEqual({
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "unavailable",
      reason: "invalid_request",
    });
    const broken = serviceFor({ readerFails: true });
    const result = await broken.service(request());
    expect(result).toEqual({
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "unavailable",
      reason: "document_unreadable",
    });
    expect(JSON.stringify(result)).not.toContain("NormalizedObject");
  });
});
