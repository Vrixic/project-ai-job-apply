import { expect, it, vi } from "vitest";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain/temporary-material";
import { authorizeNativeMaterialRead } from "./native-material-read.js";
import type { ApplicationView } from "./store.js";

const ids = [
  "019d04cf-1f80-7000-8000-000000000001",
  "019d04cf-1f80-7000-8000-000000000002",
  "019d04cf-1f80-7000-8000-000000000003",
  "019d04cf-1f80-7000-8000-000000000004",
] as const;
const reference: TemporaryMaterialReference = {
  schemaVersion: 1,
  kind: "cover_letter",
  ownerUserId: String(ids[0]),
  applicationId: ids[1],
  generationId: ids[2],
  version: 1,
  contentSha256: "a".repeat(64),
  completedAtMs: 1000,
  expiresAtMs: 1_801_000,
};
const view = () =>
  ({
    application: {
      id: ids[1],
      ownerUserId: ids[0],
      status: "review_required",
      currentPacketId: ids[3],
    },
    currentPacket: {
      userId: ids[0],
      applicationId: ids[1],
      id: ids[3],
      packetHash: "b".repeat(64),
      artifactHashes: { coverLetter: reference.contentSha256 },
      temporaryMaterials: [{ ...reference }],
    },
  }) as unknown as ApplicationView;
const input = () => ({
  store: { getApplication: vi.fn(async () => view()) },
  ownerUserId: String(ids[0]),
  reference: { ...reference },
  signal: new AbortController().signal,
  clock: () => new Date(2000),
});

it("returns only a detached original scalar packet/reference proof", async () => {
  const test = input();
  const proof = await authorizeNativeMaterialRead(test);
  expect(proof).toEqual({
    schemaVersion: 1,
    packetId: ids[3],
    packetHash: "b".repeat(64),
    reference,
  });
  expect(proof?.reference).not.toBe(test.reference);
});

it.each([
  "owner",
  "application",
  "packet",
  "packet_owner",
  "packet_application",
  "hash",
  "generation",
  "applied",
  "cancelled",
])("refuses changed %s binding", async (mode) => {
  const test = input();
  const changed = view();
  const packet = changed.currentPacket;
  const material = packet?.temporaryMaterials?.[0];
  if (!packet || !material) throw Error("SyntheticPacketMissing");
  if (mode === "owner") changed.application.ownerUserId = ids[2];
  if (mode === "application") changed.application.id = ids[2];
  if (mode === "packet") changed.application.currentPacketId = ids[2];
  if (mode === "packet_owner") packet.userId = ids[2];
  if (mode === "packet_application") packet.applicationId = ids[2];
  if (mode === "hash") packet.artifactHashes.coverLetter = "c".repeat(64);
  if (mode === "generation") material.generationId = ids[3];
  if (mode === "applied" || mode === "cancelled") changed.application.status = mode;
  test.store.getApplication.mockResolvedValue(changed);
  expect(await authorizeNativeMaterialRead(test)).toBeNull();
});

it("rejects expiry after the actual owner read and cancellation while pending", async () => {
  for (const mode of ["expired", "cancelled"]) {
    const test = input();
    const abort = new AbortController();
    test.signal = abort.signal;
    test.store.getApplication.mockImplementation(async () => {
      if (mode === "expired") test.clock = () => new Date(reference.expiresAtMs);
      else abort.abort();
      return view();
    });
    // Capture the same clock capability while allowing its observed time to advance.
    expect(await authorizeNativeMaterialRead({ ...test, clock: () => test.clock() })).toBeNull();
  }
});

it("does not read another owner's reference or an already expired/aborted allocation", async () => {
  for (const mode of ["owner", "expiry", "abort"]) {
    const test = input();
    if (mode === "owner") test.ownerUserId = ids[3];
    if (mode === "expiry") test.clock = () => new Date(reference.expiresAtMs);
    if (mode === "abort") test.signal = AbortSignal.abort();
    expect(await authorizeNativeMaterialRead(test)).toBeNull();
    expect(test.store.getApplication).not.toHaveBeenCalled();
  }
});

it("does not convert an owner outage into an affirmative proof", async () => {
  const test = input();
  test.store.getApplication.mockRejectedValue(Error("synthetic-private-outage"));
  await expect(authorizeNativeMaterialRead(test)).rejects.toThrow("synthetic-private-outage");
});
