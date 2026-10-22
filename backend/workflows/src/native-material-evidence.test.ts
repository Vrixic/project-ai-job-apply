import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { ApplicationView } from "@ai-job-apply/applications-service";
import type { NativeEvidenceBinding } from "@ai-job-apply/documents-service/native-evidence-binding";
import type { ActiveJobRecord } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import { createNativeOwnedCoverLetterEvidenceSource } from "./native-material-evidence.js";

type Options = Parameters<typeof createNativeOwnedCoverLetterEvidenceSource>[0];
type Fact = Awaited<ReturnType<Options["profile"]["listGroundingFacts"]>>[number];
const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function fixture(defaultOff = false) {
  const at = new Date();
  let leased = false;
  const fact: Fact = {
    id: id(8),
    kind: "skill",
    key: "skill",
    value: ["TypeScript"],
    verification: "confirmed",
    sensitivity: "standard",
    source: { type: "user", reference: "synthetic" },
    version: 1,
  };
  const binding: NativeEvidenceBinding = {
    scope: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      epochId: id(5),
    },
    allocation: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
    original: {
      id: id(6),
      documentId: id(4),
      purpose: "provider_dispatch",
      requestSha256: "b".repeat(64),
    },
  };
  const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
  const context = coverLetterContext({ facts: [fact], job, now: at });
  const getApplication = vi.fn(
    async () =>
      ({
        application: { id: id(3), ownerUserId: id(2), canonicalJobId: id(7) },
      }) as ApplicationView,
  );
  const getActiveJob = vi.fn(
    async () =>
      ({
        id: id(7),
        status: "active",
        title: job.title,
        company: { name: job.company },
        description: job.description,
        expiresAt: new Date(at.getTime() + 60_000),
      }) as ActiveJobRecord,
  );
  const listGroundingFacts = vi.fn(async () => [fact]);
  const withGenerationLease = vi.fn(async (_owner: string, run: () => Promise<unknown>) => {
    leased = true;
    try {
      return await run();
    } finally {
      leased = false;
    }
  }) as unknown as Options["candidateLease"]["withGenerationLease"];
  const checkAdmission = vi.fn(async (_binding: Readonly<NativeEvidenceBinding>) => {
    expect(leased).toBe(false);
  });
  const options: Options = {
    binding,
    context,
    checkAdmission,
    applications: { getApplication },
    catalog: { getActiveJob },
    profile: { listGroundingFacts },
    candidateLease: { withGenerationLease },
    ...(defaultOff ? {} : { enabled: () => true }),
  };
  return {
    source: createNativeOwnedCoverLetterEvidenceSource(options),
    options,
    binding,
    context,
    fact,
    job,
    getApplication,
    getActiveJob,
    listGroundingFacts,
    checkAdmission,
  };
}
describe("allocation-bound owning native evidence", () => {
  it("defaults off before SQL admission and owner reads", async () => {
    const f = fixture(true);
    await expect(f.source.load(id(2), id(3))).rejects.toThrow("NativeEvidenceUnavailable");
    expect(f.checkAdmission).not.toHaveBeenCalled();
    expect(f.getApplication).not.toHaveBeenCalled();
  });
  it("checks exact admission around owner reads without keeping its transaction behind the candidate lease", async () => {
    const f = fixture();
    const result = await f.source.load(id(2), id(3));
    expect(f.checkAdmission).toHaveBeenCalledTimes(2);
    expect(f.checkAdmission).toHaveBeenNthCalledWith(1, f.binding);
    expect(f.checkAdmission).toHaveBeenNthCalledWith(2, f.binding);
    expect(result.facts[0]?.value).toEqual(["TypeScript"]);
    expect(result.job).toEqual(f.job);
    expect(f.fact.value).toEqual(["TypeScript"]);
    expect(f.job.description).toBe("Build reliable systems.");
  });
  it.each([
    [id(88), id(3)],
    [id(2), id(88)],
  ])("rejects foreign owner/application before admission and owner reads", async (owner, app) => {
    const f = fixture();
    await expect(f.source.load(owner, app)).rejects.toThrow("NativeEvidenceUnavailable");
    expect(f.checkAdmission).not.toHaveBeenCalled();
    expect(f.getApplication).not.toHaveBeenCalled();
  });
  it("withholds evidence if final owning admission is sealed/quarantined/terminal", async () => {
    const f = fixture();
    f.checkAdmission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error("synthetic-database-private-details"));
    await expect(f.source.load(id(2), id(3))).rejects.toThrow(/^NativeEvidenceUnavailable$/u);
    expect(f.listGroundingFacts).toHaveBeenCalledOnce();
    expect(f.fact.value).toEqual(["TypeScript"]);
  });
  it("refuses first admission without disclosing owner values", async () => {
    const f = fixture();
    f.checkAdmission.mockRejectedValueOnce(Error("synthetic-database-private-details"));
    await expect(f.source.load(id(2), id(3))).rejects.toThrow(/^NativeEvidenceUnavailable$/u);
    expect(f.getApplication).not.toHaveBeenCalled();
  });
  it.each(["job", "facts"])(
    "refuses changed original %s context before final admission",
    async (kind) => {
      const f = fixture();
      if (kind === "job") f.job.description = "Different posting";
      else f.fact.value = ["Rust"];
      await expect(f.source.load(id(2), id(3))).rejects.toThrow("NativeEvidenceUnavailable");
      expect(f.checkAdmission).toHaveBeenCalledTimes(1);
    },
  );
  it("holds one evidence load until the original admission call settles", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.checkAdmission.mockImplementationOnce(async () => await held);
    const pending = f.source.load(id(2), id(3));
    await expect(f.source.load(id(2), id(3))).rejects.toThrow("NativeEvidenceUnavailable");
    expect(f.checkAdmission).toHaveBeenCalledTimes(1);
    release?.();
    await pending;
    expect(f.checkAdmission).toHaveBeenCalledTimes(2);
  });
  it("pins detached scope/context and returns detached evidence", async () => {
    const f = fixture();
    f.binding.scope.ownerUserId = id(88);
    f.binding.original.id = id(88);
    f.context.jobContextHash = "d".repeat(64);
    const result = await f.source.load(id(2), id(3));
    expect(f.checkAdmission.mock.calls[0]?.[0].scope.ownerUserId).toBe(id(2));
    if (result.facts[0]) result.facts[0].source.reference = "changed";
    expect(f.fact.source.reference).toBe("synthetic");
  });
  it("snapshots evidence before the final asynchronous admission", async () => {
    const f = fixture();
    f.checkAdmission
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        f.fact.value = ["Rust"];
        f.fact.source.reference = "changed";
      });
    const result = await f.source.load(id(2), id(3));
    expect(result.facts[0]?.value).toEqual(["TypeScript"]);
    expect(result.facts[0]?.source.reference).toBe("synthetic");
  });
  it("withdrawal while final proof resolves withholds values", async () => {
    const f = fixture();
    let enabled = true;
    const source = createNativeOwnedCoverLetterEvidenceSource({
      ...f.options,
      enabled: () => enabled,
    });
    f.checkAdmission
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        enabled = false;
      });
    await expect(source.load(id(2), id(3))).rejects.toThrow("NativeEvidenceUnavailable");
  });
  it.each([
    (binding: NativeEvidenceBinding) => {
      binding.scope.epochId = "foreign";
    },
    (binding: NativeEvidenceBinding) => {
      binding.allocation.ownerUserId = id(88);
    },
    (binding: NativeEvidenceBinding) => {
      binding.original.documentId = id(88);
    },
    (binding: NativeEvidenceBinding) => {
      Object.assign(binding.original, { text: "synthetic" });
    },
    (binding: NativeEvidenceBinding) => {
      Object.defineProperty(binding.scope, "hidden", { value: "synthetic" });
    },
  ])("refuses invalid immutable binding before owner effects", (alter) => {
    const f = fixture();
    alter(f.binding);
    expect(() => createNativeOwnedCoverLetterEvidenceSource(f.options)).toThrow(
      "NativeEvidenceUnavailable",
    );
    expect(f.getApplication).not.toHaveBeenCalled();
  });
});
