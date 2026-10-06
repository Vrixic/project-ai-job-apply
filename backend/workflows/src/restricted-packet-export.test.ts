import { describe, expect, it, vi } from "vitest";
import { enrichRestrictedPacketExport } from "./restricted-packet-export.js";

const owner = "0192f7c2-0000-7000-8000-000000000001";
const app = "0192f7c2-0000-7000-8000-000000000002";
const first = "0192f7c2-0000-7000-8000-000000000003";
const second = "0192f7c2-0000-7000-8000-000000000004";
const hash = "a".repeat(64);
const scope = {
  ownerUserId: owner,
  exportId: first,
  operationId: second,
  policyVersion: "synthetic-v1",
};
function fixture() {
  const reference = {
    applicationId: app,
    packetId: first,
    packetHash: hash,
    fieldKeys: ["authorization.us_authorized"],
  };
  const applications = {
    packets: [
      {
        id: first,
        applicationId: app,
        packetHash: hash,
        fields: [
          {
            fieldKey: "authorization.us_authorized",
            value: null,
            requiresReview: true,
            disposition: "review",
          },
        ],
      },
    ],
  };
  const values = new Map<string, boolean>([["authorization.us_authorized", true]]);
  const reader = {
    readExportPacketValues: vi.fn(async () => ({
      ownerUserId: owner,
      applicationId: app,
      packetId: first,
      packetHash: hash,
      values,
    })),
  };
  return {
    applications,
    inventory: { schemaVersion: 1, packets: [reference] },
    scope: { ...scope },
    reader,
    values,
    reference,
  };
}
describe("restricted packet historical export enrichment", () => {
  it("copies exact chosen values without changing input metadata or copying private inventory", async () => {
    const input = fixture();
    const output = await enrichRestrictedPacketExport(input);
    expect(output).toEqual({
      packets: [
        {
          id: first,
          applicationId: app,
          packetHash: hash,
          fields: [
            {
              fieldKey: "authorization.us_authorized",
              value: true,
              requiresReview: true,
              disposition: "review",
            },
          ],
        },
      ],
    });
    expect(input.applications.packets[0]?.fields[0]?.value).toBeNull();
    expect(input.reader.readExportPacketValues).toHaveBeenCalledWith({
      ...scope,
      applicationId: app,
      packetId: first,
      packetHash: hash,
    });
    expect(input.values.size).toBe(0);
    expect(JSON.stringify(output)).not.toContain("fieldKeys");
  });
  it("supports old metadata-only fragments when no protected reader or inventory is present", async () => {
    const input = fixture();
    expect(
      await enrichRestrictedPacketExport({
        applications: input.applications,
        inventory: undefined,
        scope,
      }),
    ).toBe(input.applications);
    await expect(enrichRestrictedPacketExport({ ...input, inventory: undefined })).rejects.toThrow(
      "RestrictedPacketExportRejected",
    );
  });
  it("fails closed when the exact reader is unavailable", async () => {
    const input = fixture();
    const { reader: _reader, ...rest } = input;
    await expect(enrichRestrictedPacketExport(rest)).rejects.toThrow(
      "RestrictedPacketExportRejected",
    );
  });
  it.each([
    "extra",
    "getter",
    "hidden",
    "symbol",
    "missing key",
    "duplicate key",
    "unknown packet",
    "wrong hash",
    "plaintext",
    "document",
  ])("refuses invalid private inventory/context: %s before a value read", async (kind) => {
    const input = fixture();
    const getter = vi.fn(() => "synthetic-body");
    if (kind === "extra") Object.assign(input.reference, { rawBody: "synthetic-body" });
    if (kind === "getter")
      Object.defineProperty(input.reference, "packetHash", { enumerable: true, get: getter });
    if (kind === "hidden")
      Object.defineProperty(input.reference, "rawBody", { value: "synthetic-body" });
    if (kind === "symbol") Object.assign(input.reference, { [Symbol("body")]: "synthetic-body" });
    if (kind === "missing key") input.reference.fieldKeys = [];
    if (kind === "duplicate key")
      input.reference.fieldKeys.push(input.reference.fieldKeys[0] ?? "invalid");
    if (kind === "unknown packet") input.reference.packetId = second;
    if (kind === "wrong hash") input.reference.packetHash = "b".repeat(64);
    if (kind === "plaintext")
      Object.assign(input.applications.packets[0]?.fields[0] ?? {}, { value: true });
    if (kind === "document") input.reference.fieldKeys = ["documents.cover_letter"];
    await expect(enrichRestrictedPacketExport(input)).rejects.toThrow(
      "RestrictedPacketExportRejected",
    );
    expect(input.reader.readExportPacketValues).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["owner", "packet", "hash", "missing value", "extra value"])(
    "withholds a mismatched result: %s and clears its values",
    async (kind) => {
      const input = fixture();
      const response = {
        ownerUserId: owner,
        applicationId: app,
        packetId: first,
        packetHash: hash,
        values: input.values,
      };
      if (kind === "owner") response.ownerUserId = second;
      if (kind === "packet") response.packetId = second;
      if (kind === "hash") response.packetHash = "b".repeat(64);
      if (kind === "missing value") response.values.clear();
      if (kind === "extra value") response.values.set("another.field", false);
      input.reader.readExportPacketValues.mockResolvedValue(response);
      await expect(enrichRestrictedPacketExport(input)).rejects.toThrow(
        "RestrictedPacketExportRejected",
      );
      expect(response.values.size).toBe(0);
      expect(input.applications.packets[0]?.fields[0]?.value).toBeNull();
    },
  );
  it("preserves independently chosen values for two historical versions", async () => {
    const input = fixture();
    input.inventory.packets.push({ ...input.reference, packetId: second });
    input.applications.packets.push({
      ...input.applications.packets[0],
      id: second,
      applicationId: app,
      packetHash: hash,
      fields: [
        {
          fieldKey: "authorization.us_authorized",
          value: null,
          requiresReview: true,
          disposition: "review",
        },
      ],
    });
    input.reader.readExportPacketValues.mockImplementation(async (command?: unknown) => ({
      ownerUserId: owner,
      applicationId: app,
      packetId: (command as { packetId: string }).packetId,
      packetHash: hash,
      values: new Map([
        ["authorization.us_authorized", (command as { packetId: string }).packetId === first],
      ]),
    }));
    const output = await enrichRestrictedPacketExport(input);
    expect(
      (output.packets as typeof input.applications.packets).map(
        (packet) => packet.fields[0]?.value,
      ),
    ).toEqual([true, false]);
  });
  it("rejects a result accessor without invoking it during cleanup", async () => {
    const input = fixture();
    const response = {
      ownerUserId: owner,
      applicationId: app,
      packetId: first,
      packetHash: hash,
      values: input.values,
    };
    const getter = vi.fn(() => input.values);
    Object.defineProperty(response, "values", { enumerable: true, get: getter });
    input.reader.readExportPacketValues.mockResolvedValue(response);
    await expect(enrichRestrictedPacketExport(input)).rejects.toThrow(
      "RestrictedPacketExportRejected",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(input.applications.packets[0]?.fields[0]?.value).toBeNull();
  });
  it("refuses a map with overridden methods and clears it through the native method", async () => {
    const input = fixture();
    const get = vi.fn(() => false);
    const clear = vi.fn();
    Object.assign(input.values, { get, clear });
    await expect(enrichRestrictedPacketExport(input)).rejects.toThrow(
      "RestrictedPacketExportRejected",
    );
    expect(get).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(input.values.size).toBe(0);
  });
});
