import { GenerationQuiescenceProof } from "@ai-job-apply/documents-service/generation-quiescence";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { AwsCandidateDocumentObjectStore } from "./candidate-rights-aws.js";

const documentId = "019d04cf-1f80-7000-8000-000000000001";
const otherId = "019d04cf-1f80-7000-8000-000000000002";
const key = (slot: string, owner = documentId) => `normalized/${owner}/generation/${slot}.v1.json`;
interface Entry {
  Key: string;
  VersionId: string;
  marker?: boolean;
  etag?: string;
}

// Versioned-S3 state machine, not live S3. A permanent delete can reveal an older version.
// Probe a late provider's pinned If-Match after EACH permanent removal, including inside batches.
function bucket(
  options: {
    historicalCount?: number;
    failHistory?: boolean;
    failFence?: boolean;
    staleFenceListing?: boolean;
    retainHistory?: boolean;
    loseFence?: boolean;
    lateCreation?: boolean;
    omitFenceAck?: boolean;
    unconfirmedQuiescence?: boolean;
  } = {},
) {
  const slots = ["request", "dispatch", "result"];
  let sequence = 0;
  let entries: Entry[] = slots.flatMap((slot) => [
    { Key: key(slot), VersionId: `placeholder-${slot}`, etag: `placeholder-${slot}` },
    ...Array.from({ length: options.historicalCount ?? 1 }, (_, index) => ({
      Key: key(slot),
      VersionId: `settled-${slot}-${index}`,
      etag: `settled-${slot}-${index}`,
    })),
    { Key: key(slot), VersionId: `old-marker-${slot}`, marker: true },
  ]);
  const neighbor: Entry = {
    Key: key("dispatch", otherId),
    VersionId: "keep-neighbor",
    etag: "neighbor",
  };
  entries.push(neighbor);
  const current = (objectKey: string) => entries.filter((entry) => entry.Key === objectKey).at(-1);
  const createdFences: Entry[] = [];
  const removed: Entry[] = [];
  const lateWrites: string[] = [];
  const deniedProbes: string[] = [];
  const probe = () => {
    for (const slot of ["dispatch", "result"]) {
      const latest = current(key(slot));
      if (latest && !latest.marker && latest.etag === `placeholder-${slot}`) {
        lateWrites.push(slot);
        entries.push({ Key: key(slot), VersionId: `late-${++sequence}`, etag: "late" });
      } else deniedProbes.push(slot);
    }
  };
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      const matching = entries.filter((entry) => entry.Key.startsWith(command.input.Prefix ?? ""));
      const start = command.input.KeyMarker ? Number(command.input.VersionIdMarker) : 0;
      const page = matching.slice(start, start + 1_000);
      const listed = page.map((entry) => ({
        Key: entry.Key,
        VersionId: entry.VersionId,
        IsLatest:
          options.staleFenceListing && entry.VersionId.startsWith("fence-")
            ? false
            : current(entry.Key) === entry,
      }));
      return {
        IsTruncated: start + 1_000 < matching.length,
        ...(start + 1_000 < matching.length
          ? {
              NextKeyMarker: page.at(-1)?.Key,
              NextVersionIdMarker: String(start + 1_000),
            }
          : {}),
        Versions: listed.filter(
          (item) => !matching.find((entry) => entry.VersionId === item.VersionId)?.marker,
        ),
        DeleteMarkers: listed.filter(
          (item) => matching.find((entry) => entry.VersionId === item.VersionId)?.marker,
        ),
      };
    }
    if (command instanceof DeleteObjectCommand) {
      expect(command.input.VersionId).toBeUndefined();
      expect(slots.map((slot) => key(slot))).toContain(command.input.Key);
      const fence = {
        Key: command.input.Key as string,
        VersionId: `fence-${++sequence}`,
        marker: true,
      };
      entries.push(fence);
      createdFences.push(fence);
      return options.omitFenceAck
        ? {}
        : { $metadata: { httpStatusCode: 204 }, DeleteMarker: true, VersionId: fence.VersionId };
    }
    if (command instanceof DeleteObjectsCommand) {
      const objects = command.input.Delete?.Objects ?? [];
      const removingFence =
        objects.length > 0 &&
        objects.every(
          (item) =>
            item.VersionId?.startsWith("fence-") &&
            !!item.Key &&
            current(item.Key)?.VersionId === item.VersionId,
        );
      if (options.failHistory && !removingFence) {
        options.failHistory = false;
        return { Errors: [{ Code: "AccessDenied" }] };
      }
      if (options.failFence && removingFence) {
        options.failFence = false;
        return { Errors: [{ Code: "AccessDenied" }] };
      }
      if (removingFence) {
        // Every original data/marker version is gone before any current fence is removed.
        expect(
          entries
            .filter((entry) => entry.Key.startsWith(`normalized/${documentId}/`))
            .every((entry) => entry.VersionId.startsWith("fence-")),
        ).toBe(true);
      }
      for (const object of objects) {
        const entry = entries.find(
          (item) => item.Key === object.Key && item.VersionId === object.VersionId,
        );
        if (!entry) continue;
        if (options.retainHistory && !removingFence && entry.VersionId === "placeholder-dispatch")
          continue;
        entries = entries.filter((item) => item !== entry);
        removed.push(entry);
        probe();
      }
      if (options.loseFence && !removingFence)
        entries = entries.filter((entry) => entry !== createdFences[0]);
      if (options.lateCreation && removingFence)
        entries.push({ Key: key("result"), VersionId: "unauthorized-late-create" });
      return {};
    }
    throw Error("SyntheticUnexpectedCommand");
  });
  return {
    store: new AwsCandidateDocumentObjectStore(
      "synthetic-bucket",
      { send },
      options.unconfirmedQuiescence ? undefined : { confirm: async () => true },
    ),
    send,
    entries: () => entries,
    neighbor,
    createdFences,
    removed,
    lateWrites,
    deniedProbes,
  };
}

describe("cover-letter generation purge fences (offline versioned S3)", () => {
  it("refuses generation history cleanup without private writer/provider proof", async () => {
    const fixture = bucket({ unconfirmedQuiescence: true });
    await expect(fixture.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
      "CandidateGenerationQuiescenceUnconfirmed",
    );
    expect(fixture.removed).toEqual([]);
    expect(fixture.createdFences).toEqual([]);
  });
  it("deletes generation history only when the real Documents proof sees settled writers", async () => {
    const quiet = (
      workStates: string[],
      responseStates: string[],
      ownerAccountState = "quarantined",
    ) =>
      new GenerationQuiescenceProof({
        read: async () => ({ letter: { ownerAccountState }, workStates, responseStates }),
      });
    for (const [proof, expected] of [
      [quiet(["settled", "revoked"], ["disposed"]), true],
      [quiet(["running"], []), false],
      [quiet(["settled"], ["acknowledged"]), false],
      [quiet(["settled"], ["disposed"], "active"), false],
    ] as const) {
      const fixture = bucket();
      const store = new AwsCandidateDocumentObjectStore(
        "synthetic-bucket",
        { send: fixture.send },
        proof,
      );
      if (expected) {
        await expect(store.purgeDocumentPrefixes(documentId)).resolves.toMatchObject({
          remaining: 0,
        });
        expect(fixture.removed.length).toBeGreaterThan(0);
      } else {
        await expect(store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
          "CandidateGenerationQuiescenceUnconfirmed",
        );
        expect(fixture.removed).toEqual([]);
        expect(fixture.createdFences).toEqual([]);
      }
    }
  });
  it.each([undefined, false, "true", 1, new Error("synthetic private diagnostic")])(
    "refuses empty-prefix pending reservation cleanup on absent/invalid/failed proof %s",
    async (value) => {
      const send = vi.fn(async () => ({}));
      const confirm = vi.fn(async () => {
        if (value instanceof Error) throw value;
        return value as boolean;
      });
      const store = new AwsCandidateDocumentObjectStore(
        "synthetic-bucket",
        { send },
        value === undefined ? undefined : { confirm },
      );
      await expect(
        store.deleteAllVersionsAndMarkers([
          {
            documentId,
            sourceObjectKey: `normalized/${documentId}/cover-letter.v1.json`,
          },
        ]),
      ).rejects.toThrow("CandidateGenerationQuiescenceUnconfirmed");
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("checks every pending reservation before any candidate object deletion", async () => {
    const send = vi.fn(async () => ({}));
    const confirm = vi.fn(async (id: string) => id === documentId);
    const store = new AwsCandidateDocumentObjectStore("synthetic-bucket", { send }, { confirm });
    await expect(
      store.deleteAllVersionsAndMarkers(
        [documentId, otherId].map((id) => ({
          documentId: id,
          sourceObjectKey: `normalized/${id}/cover-letter.v1.json`,
        })),
      ),
    ).rejects.toThrow("CandidateGenerationQuiescenceUnconfirmed");
    expect(confirm.mock.calls.map(([id]) => id)).toEqual([documentId, otherId]);
    expect(send).not.toHaveBeenCalled();
  });
  it("bounds an unresolved proof and never deletes on a local deadline", async () => {
    const send = vi.fn(async () => ({}));
    const confirm = vi.fn(async () => new Promise<boolean>(() => undefined));
    const store = new AwsCandidateDocumentObjectStore("synthetic-bucket", { send }, { confirm });
    const pending = expect(
      store.deleteAllVersionsAndMarkers([
        {
          documentId,
          sourceObjectKey: `normalized/${documentId}/cover-letter.v1.json`,
        },
      ]),
    ).rejects.toThrow("CandidateGenerationQuiescenceUnconfirmed");
    await pending;
    expect(send).not.toHaveBeenCalled();
  }, 15_000);
  it("keeps current delete markers until all history is gone, including probes within batches", async () => {
    const fixture = bucket();
    expect(await fixture.store.purgeDocumentPrefixes(documentId)).toEqual({
      deleted: 12,
      remaining: 0,
    });
    expect(fixture.createdFences).toHaveLength(3);
    expect(fixture.entries()).toEqual([fixture.neighbor]);
    expect(fixture.lateWrites).toEqual([]);
    expect(fixture.deniedProbes.length).toBeGreaterThan(0);
    expect(fixture.removed.slice(-3)).toEqual(fixture.createdFences);
  });
  it("never bypasses the fence when an exact account inventory names a generation slot", async () => {
    const fixture = bucket();
    expect(
      await fixture.store.deleteAllVersionsAndMarkers([
        {
          documentId,
          sourceObjectKey: key("dispatch"),
          sourceObjectVersion: "placeholder-dispatch",
          normalizedObjectKey: key("result"),
          normalizedObjectVersion: "placeholder-result",
        },
      ]),
    ).toEqual({ exactInventoryEmpty: true });
    expect(fixture.lateWrites).toEqual([]);
    expect(fixture.createdFences).toHaveLength(3);
    expect(fixture.entries()).toEqual([fixture.neighbor]);
  });
  it("keeps fences through multiple thousand-version delete batches", async () => {
    const fixture = bucket({ historicalCount: 400 });
    expect(await fixture.store.purgeDocumentPrefixes(documentId)).toEqual({
      deleted: 1209,
      remaining: 0,
    });
    const batches = fixture.send.mock.calls.filter(
      ([command]) => command instanceof DeleteObjectsCommand,
    );
    expect(batches).toHaveLength(3);
    expect(fixture.lateWrites).toEqual([]);
  });
  it.each(["failHistory", "failFence"] as const)(
    "retains fences and safely retries %s",
    async (failure) => {
      const fixture = bucket({ [failure]: true });
      await expect(fixture.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
        "ResumePurgeObjectDeletionIncomplete",
      );
      expect(
        fixture
          .entries()
          .filter((entry) => entry.Key.startsWith(`normalized/${documentId}/`))
          .filter((entry) => entry.marker),
      ).toHaveLength(failure === "failHistory" ? 6 : 3);
      expect((await fixture.store.purgeDocumentPrefixes(documentId)).remaining).toBe(0);
      expect(fixture.entries()).toEqual([fixture.neighbor]);
      expect(fixture.lateWrites).toEqual([]);
    },
  );
  it.each(["staleFenceListing", "omitFenceAck"] as const)(
    "refuses unconfirmed fence before history removal (%s)",
    async (failure) => {
      const fixture = bucket({ [failure]: true });
      await expect(fixture.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
        "ResumePurgeGenerationFenceUnconfirmed",
      );
      expect(fixture.removed).toEqual([]);
      expect(
        fixture.send.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand),
      ).toBe(false);
    },
  );
  it("refuses success and leaves fences when historical bytes survive an acknowledged delete", async () => {
    const fixture = bucket({ retainHistory: true });
    await expect(fixture.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
      "ResumePurgeObjectDeletionIncomplete",
    );
    expect(fixture.entries().filter((entry) => entry.VersionId.startsWith("fence-"))).toHaveLength(
      3,
    );
    expect(fixture.lateWrites).toEqual([]);
  });
  it("refuses success when a fence disappears during history removal", async () => {
    const fixture = bucket({ loseFence: true });
    await expect(fixture.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
      "ResumePurgeGenerationFenceUnconfirmed",
    );
    expect(fixture.removed.every((entry) => !entry.VersionId.startsWith("fence-"))).toBe(true);
  });
  it("reports a forbidden late creator rather than falsely proving deletion", async () => {
    const fixture = bucket({ lateCreation: true });
    expect((await fixture.store.purgeDocumentPrefixes(documentId)).remaining).toBe(1);
  });
  it("replay on an empty prefix creates no new markers and preserves other candidates", async () => {
    const fixture = bucket();
    await fixture.store.purgeDocumentPrefixes(documentId);
    expect(await fixture.store.purgeDocumentPrefixes(documentId)).toEqual({
      deleted: 0,
      remaining: 0,
    });
    expect(fixture.createdFences).toHaveLength(3);
    expect(fixture.entries()).toEqual([fixture.neighbor]);
  });
});
