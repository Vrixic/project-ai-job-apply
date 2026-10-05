import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialReference,
  TemporaryMaterialStore,
  TemporaryMaterialUnavailable,
  validateTemporaryMaterialReference,
} from "./temporary-materials.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const OWNER = "019d04cf-1f80-7000-8000-000000000001";
const APP = "019d04cf-1f80-7000-8000-000000000002";
const GENERATION = "019d04cf-1f80-7000-8000-000000000003";
const OTHER = "019d04cf-1f80-7000-8000-000000000004";
const bytes = new TextEncoder().encode("Synthetic temporary material");
const reference = (
  patch: Partial<TemporaryMaterialReference> = {},
): TemporaryMaterialReference => ({
  schemaVersion: 1,
  kind: "cover_letter",
  generationId: GENERATION,
  ownerUserId: OWNER,
  applicationId: APP,
  version: 1,
  contentSha256: "a".repeat(64),
  completedAtMs: NOW,
  expiresAtMs: NOW + GENERATED_MATERIAL_LIFETIME_MS,
  ...patch,
});
const stores: TemporaryMaterialStore[] = [];
function fixture(options: ConstructorParameters<typeof TemporaryMaterialStore>[0] = {}) {
  const store = new TemporaryMaterialStore({
    wallNow: Date.now,
    monotonicNow: Date.now,
    ...options,
  });
  stores.push(store);
  return store;
}
const publish = (store: TemporaryMaterialStore, ref = reference()) => {
  const staged = store.stage(ref, bytes);
  staged.publish();
  return staged;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
});

describe("bounded temporary generated material storage", () => {
  it("holds borrow capacity until an idempotent explicit release", async () => {
    const store = fixture({ maximumBorrows: 1 });
    publish(store);
    const lease = store.leaseMaterial(reference(), 1024);
    expect(lease.isCurrent()).toBe(true);
    expect(lease.bytes).toEqual(bytes);
    await expect(store.withMaterial(reference(), async () => true)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    lease.release();
    lease.release();
    expect(lease.isCurrent()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.bytes.every((byte) => byte === 0)).toBe(true);
    expect(await store.withMaterial(reference(), async () => true)).toBe(true);
  });
  it("accounts reserved outgoing bytes before granting another copy", () => {
    const store = fixture({ maximumBytes: bytes.length * 3 + 100 });
    publish(store);
    const lease = store.leaseMaterial(reference(), 100);
    expect(() => store.leaseMaterial(reference(), 1)).toThrow("TemporaryMaterialUnavailable");
    lease.release();
    const next = store.leaseMaterial(reference(), 100);
    expect(next.isCurrent()).toBe(true);
    next.release();
  });
  it("cancels controlled bytes without releasing an unsettled callback's reservation", async () => {
    const store = fixture({ maximumBorrows: 1 });
    publish(store);
    const lease = store.leaseMaterial(reference(), 100);
    lease.cancel();
    expect(lease.signal.aborted).toBe(true);
    expect(lease.bytes.every((byte) => byte === 0)).toBe(true);
    expect(() => store.leaseMaterial(reference())).toThrow("TemporaryMaterialUnavailable");
    lease.release();
    expect(await store.withMaterial(reference(), async () => true)).toBe(true);
  });
  it("terminal sealing clears staged/active material and refuses a late new generation", () => {
    const store = fixture();
    publish(store);
    const lease = store.leaseMaterial(reference());
    store.sealApplication(OWNER, APP);
    expect(lease.isCurrent()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.bytes.every((byte) => byte === 0)).toBe(true);
    expect(() => store.stage(reference({ generationId: OTHER }), bytes)).toThrow(
      "TemporaryMaterialUnavailable",
    );
    lease.release();
    store.sealApplication(OWNER, APP);
  });
  it("bounds terminal scope fences and closes safely when capacity is exhausted", () => {
    const store = fixture({ maximumEntries: 1 });
    publish(store);
    store.sealApplication(OWNER, APP);
    store.sealApplication(OWNER, OTHER);
    expect(() =>
      store.stage(reference({ generationId: OTHER, applicationId: GENERATION }), bytes),
    ).toThrow("TemporaryMaterialUnavailable");
  });
  it.each([-1, NaN, 2 * 1024 * 1024 + 1])(
    "refuses invalid outgoing reservation %s without consuming capacity",
    async (budget) => {
      const store = fixture({ maximumBorrows: 1 });
      publish(store);
      expect(() => store.leaseMaterial(reference(), budget)).toThrow(
        "TemporaryMaterialUnavailable",
      );
      expect(await store.withMaterial(reference(), async () => true)).toBe(true);
    },
  );

  it("keeps staged material unavailable until publication and detaches caller inputs", async () => {
    const store = fixture();
    const ref = reference();
    const content = Uint8Array.from(bytes);
    const admission = store.stage(ref, content);
    content.fill(0);
    ref.contentSha256 = "b".repeat(64);
    expect(store.has(reference())).toBe(false);
    await expect(store.withMaterial(reference(), async () => true)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(await admission.verify(async (copy) => new TextDecoder().decode(copy))).toBe(
      "Synthetic temporary material",
    );
    admission.publish();
    expect(store.has(reference())).toBe(true);
    expect(Object.isFrozen(admission.reference)).toBe(true);
  });

  it("actively clears an idle material at its original absolute deadline", async () => {
    const store = fixture();
    const admission = publish(store);
    await vi.advanceTimersByTimeAsync(GENERATED_MATERIAL_LIFETIME_MS - 1);
    expect(store.has(reference())).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.has(reference())).toBe(false);
    expect(() => admission.publish()).toThrow(TemporaryMaterialUnavailable);
    expect(() => store.stage(reference(), bytes)).toThrow(TemporaryMaterialUnavailable);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads and repeated verification cannot slide the deadline", async () => {
    const store = fixture();
    publish(store);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(300_000);
      await store.withMaterial(reference(), async () => undefined);
      expect(() => store.stage(reference(), bytes)).toThrow(TemporaryMaterialUnavailable);
    }
    await vi.advanceTimersByTimeAsync(300_000);
    expect(store.has(reference())).toBe(false);
  });

  it("zeros managed active copies and aborts the borrow while its callback is stalled", async () => {
    const store = fixture();
    publish(store);
    let copied: Uint8Array | undefined;
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reading = store.withMaterial(reference(), async (value, active) => {
      copied = value;
      signal = active;
      await blocked;
      return "late response";
    });
    const refused = expect(reading).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
    await vi.advanceTimersByTimeAsync(GENERATED_MATERIAL_LIFETIME_MS);
    expect(copied?.every((byte) => byte === 0)).toBe(true);
    expect(signal?.aborted).toBe(true);
    finish();
    await refused;
  });

  it("refuses output that crosses expiry even if the cleanup timer has not run", async () => {
    const store = fixture();
    publish(store);
    await expect(
      store.withMaterial(reference(), async () => {
        vi.setSystemTime(NOW + GENERATED_MATERIAL_LIFETIME_MS);
        return true;
      }),
    ).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
    expect(store.has(reference())).toBe(false);
  });

  it.each([
    "ownerUserId",
    "applicationId",
    "generationId",
    "contentSha256",
    "version",
    "kind",
    "completedAtMs",
    "expiresAtMs",
  ] as const)("refuses a neighboring %s reference", async (key) => {
    const store = fixture();
    publish(store);
    const ref = reference();
    const bad = {
      ...ref,
      [key]:
        key === "version"
          ? 2
          : key === "kind"
            ? "tailored_resume"
            : key === "contentSha256"
              ? "b".repeat(64)
              : key === "completedAtMs"
                ? NOW + 1
                : key === "expiresAtMs"
                  ? ref.expiresAtMs + 1
                  : OTHER,
    };
    await expect(
      store.withMaterial(bad as TemporaryMaterialReference, async () => true),
    ).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
  });

  it("same content in a new generation never satisfies the old generation's reference", async () => {
    const store = fixture();
    publish(store);
    store.discard(reference());
    const newer = reference({ generationId: OTHER, version: 2 });
    publish(store, newer);
    expect(store.has(reference())).toBe(false);
    expect(store.has(newer)).toBe(true);
  });

  it("does not reconstruct a material after restart", async () => {
    const old = fixture();
    publish(old);
    old.dispose();
    const restarted = fixture();
    expect(restarted.has(reference())).toBe(false);
    await expect(restarted.withMaterial(reference(), async () => true)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(() => old.stage(reference(), bytes)).toThrow(TemporaryMaterialUnavailable);
  });

  it.each(["discard", "application", "owner", "shutdown"])(
    "%s clears active copies and prevents restoration",
    async (action) => {
      const store = fixture();
      publish(store);
      let copied: Uint8Array | undefined;
      let signal: AbortSignal | undefined;
      await expect(
        store.withMaterial(reference(), async (value, active) => {
          copied = value;
          signal = active;
          if (action === "discard") store.discard(reference());
          else if (action === "application") store.discardApplication(OWNER, APP);
          else if (action === "owner") store.discardOwner(OWNER);
          else store.dispose();
          return true;
        }),
      ).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
      expect(copied?.every((byte) => byte === 0)).toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(() => store.stage(reference(), bytes)).toThrow(TemporaryMaterialUnavailable);
    },
  );

  it("owner and application cleanup do not erase a neighbor", () => {
    const store = fixture();
    publish(store);
    const neighbor = reference({ generationId: OTHER, applicationId: OTHER });
    publish(store, neighbor);
    store.discardApplication(OWNER, APP);
    expect(store.has(neighbor)).toBe(true);
    store.discardOwner(OTHER);
    expect(store.has(neighbor)).toBe(true);
    store.discardOwner(OWNER);
    expect(store.has(neighbor)).toBe(false);
  });

  it("counts tombstones toward the bounded entry cap until expiry", async () => {
    const store = fixture({ maximumEntries: 1 });
    publish(store);
    store.discard(reference());
    expect(() => publish(store, reference({ generationId: OTHER }))).toThrow(
      TemporaryMaterialUnavailable,
    );
    await vi.advanceTimersByTimeAsync(GENERATED_MATERIAL_LIFETIME_MS);
    publish(
      store,
      reference({
        generationId: OTHER,
        completedAtMs: Date.now(),
        expiresAtMs: Date.now() + GENERATED_MATERIAL_LIFETIME_MS,
      }),
    );
  });

  it("refuses capacity pressure without evicting approved content", async () => {
    const store = fixture({ maximumBytes: bytes.length * 2, maximumMaterialBytes: bytes.length });
    publish(store);
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = store.withMaterial(reference(), async () => waiting);
    await expect(store.withMaterial(reference(), async () => true)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(() => publish(store, reference({ generationId: OTHER }))).toThrow(
      TemporaryMaterialUnavailable,
    );
    finish();
    await first;
    expect(store.has(reference())).toBe(true);
    expect(() =>
      store.stage(reference({ generationId: OTHER }), new Uint8Array(bytes.length + 1)),
    ).toThrow(TemporaryMaterialUnavailable);
  });

  it("bounds simultaneous readers independently of byte capacity", async () => {
    const store = fixture({ maximumBorrows: 1 });
    publish(store);
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = store.withMaterial(reference(), async () => wait);
    await expect(store.withMaterial(reference(), async () => true)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    finish();
    await first;
    await store.withMaterial(reference(), async () => true);
  });

  it("refuses mutation of managed bytes and sanitizes callback exceptions", async () => {
    const store = fixture();
    publish(store);
    await expect(
      store.withMaterial(reference(), async (value) => {
        value[0] = 0;
        return true;
      }),
    ).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
    await expect(
      store.withMaterial(reference(), async () => {
        throw Error("Synthetic confidential error");
      }),
    ).rejects.toThrow("TemporaryMaterialUnavailable");
    expect(
      await store.withMaterial(reference(), async (value) => new TextDecoder().decode(value)),
    ).toBe("Synthetic temporary material");
  });

  it("clock rollback fails closed and clears all material", async () => {
    let wall = NOW;
    let elapsed = 0;
    const store = fixture({ wallNow: () => wall, monotonicNow: () => elapsed });
    publish(store);
    wall -= 1;
    elapsed += 1;
    expect(() => store.has(reference())).toThrow(TemporaryMaterialUnavailable);
    wall = NOW;
    expect(() => store.has(reference())).toThrow(TemporaryMaterialUnavailable);
  });

  it("sanitizes a failing clock and permanently closes admission", () => {
    let failed = false;
    const store = fixture({
      wallNow: () => {
        if (failed) throw Error("Synthetic confidential clock error");
        return NOW;
      },
    });
    publish(store);
    failed = true;
    expect(() => store.has(reference())).toThrow("TemporaryMaterialUnavailable");
    failed = false;
    expect(() => store.stage(reference({ generationId: OTHER }), bytes)).toThrow(
      "TemporaryMaterialUnavailable",
    );
  });

  it("refuses a detached borrow without leaking the failure or losing capacity accounting", async () => {
    const store = fixture({ maximumBytes: bytes.length * 2 });
    publish(store);
    await expect(
      store.withMaterial(reference(), async (copy) => {
        structuredClone(copy, { transfer: [copy.buffer] });
        return true;
      }),
    ).rejects.toThrow("TemporaryMaterialUnavailable");
    expect(await store.withMaterial(reference(), async () => true)).toBe(true);
  });

  it("uses monotonic expiry when wall time stops advancing", () => {
    let elapsed = 0;
    const store = fixture({ wallNow: () => NOW, monotonicNow: () => elapsed });
    publish(store);
    elapsed = GENERATED_MATERIAL_LIFETIME_MS;
    expect(store.has(reference())).toBe(false);
  });

  it.each([NaN, Infinity, -1, 0, 129, 1.5])("refuses invalid entry limit %s", (maximumEntries) => {
    expect(() => fixture({ maximumEntries })).toThrow(TemporaryMaterialUnavailable);
  });

  it("rejects future/expired completion times and empty content", () => {
    const store = fixture();
    for (const completedAtMs of [NOW + 1, NOW - GENERATED_MATERIAL_LIFETIME_MS])
      expect(() =>
        store.stage(
          reference({ completedAtMs, expiresAtMs: completedAtMs + GENERATED_MATERIAL_LIFETIME_MS }),
          bytes,
        ),
      ).toThrow(TemporaryMaterialUnavailable);
    expect(() => store.stage(reference(), new Uint8Array())).toThrow(TemporaryMaterialUnavailable);
  });
});

describe("closed metadata-only temporary material references", () => {
  it("accepts both material kinds and rejects content, deadline extension, accessors and hidden keys", () => {
    expect(validateTemporaryMaterialReference(reference())).toBe(true);
    expect(validateTemporaryMaterialReference(reference({ kind: "tailored_resume" }))).toBe(true);
    for (const invalid of [
      { ...reference(), text: "Synthetic forbidden content" },
      reference({ expiresAtMs: NOW + GENERATED_MATERIAL_LIFETIME_MS + 1 }),
      reference({ version: NaN }),
      reference({ contentSha256: "A".repeat(64) }),
      Object.create(reference()),
      Object.assign(Object.create({ unrelated: true }), reference()),
      {
        ...reference(),
        get ownerUserId() {
          throw Error("Must not execute");
        },
      },
      Object.defineProperty(reference(), "hidden", { value: true }),
      { ...reference(), [Symbol("hidden")]: true },
    ])
      expect(validateTemporaryMaterialReference(invalid)).toBe(false);
  });
});
