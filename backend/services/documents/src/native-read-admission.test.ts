import { describe, expect, it, vi } from "vitest";
import { createAdmittedNativeReadAuthorization } from "./native-read-admission.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function fixture(defaultOff = false) {
  const binding = {
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
      purpose: "provider_dispatch" as const,
      requestSha256: "b".repeat(64),
    },
  };
  const now = Date.now();
  const reference = {
    schemaVersion: 1 as const,
    kind: "cover_letter" as const,
    ownerUserId: id(2),
    applicationId: id(3),
    generationId: id(4),
    version: 2,
    contentSha256: "c".repeat(64),
    completedAtMs: now,
    expiresAtMs: now + 1_800_000,
  };
  const proof = {
    schemaVersion: 1 as const,
    packetId: id(7),
    packetHash: "d".repeat(64),
    reference,
  };
  const events: string[] = [];
  const admit = vi.fn(async () => {
    events.push("admit");
  });
  const authorize = vi.fn(async () => {
    events.push("authorize");
    return proof;
  });
  const controller = new AbortController();
  const read = createAdmittedNativeReadAuthorization({
    binding,
    checkAdmission: admit,
    authorize,
    ...(defaultOff ? {} : { enabled: () => true }),
  });
  const run = () => read(id(2), id(3), reference, controller.signal, "synthetic-token");
  return { reference, proof, events, admit, authorize, controller, run };
}
describe("original native read admission", () => {
  it("surrounds the packet proof with original owning admission", async () => {
    const f = fixture();
    expect(await f.run()).toEqual(f.proof);
    expect(f.events).toEqual(["admit", "authorize", "admit"]);
  });
  it("refuses sealing during the packet read", async () => {
    const f = fixture();
    f.admit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("SyntheticSealed"));
    await expect(f.run()).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(f.authorize).toHaveBeenCalledOnce();
  });
  it("refuses before packet authorization when admission is closed", async () => {
    const f = fixture();
    f.admit.mockRejectedValue(Error("SyntheticRetired"));
    await expect(f.run()).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it("defaults off before any remote operation", async () => {
    const f = fixture(true);
    await expect(f.run()).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(f.admit).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it("rejects a foreign original generation before admission", async () => {
    const f = fixture();
    f.reference.generationId = id(9);
    await expect(f.run()).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(f.admit).not.toHaveBeenCalled();
  });
  it("withholds the proof when the caller aborts during authorization", async () => {
    const f = fixture();
    f.authorize.mockImplementation(async () => {
      f.controller.abort();
      return f.proof;
    });
    await expect(f.run()).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(f.admit).toHaveBeenCalledOnce();
  });
});
