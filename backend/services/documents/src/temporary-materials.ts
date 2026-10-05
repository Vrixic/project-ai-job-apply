import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  TemporaryMaterialUnavailable,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export * from "./temporary-material-reference.js";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_MATERIAL_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 128;
const MAX_BORROWS = 16;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

type Borrow = { bytes: Uint8Array; sizeBytes: number; controller: AbortController };
type Entry = {
  reference: Readonly<TemporaryMaterialReference>;
  bytes: Uint8Array;
  bytesHash: string;
  monotonicExpiry: number;
  state: "pending" | "ready" | "discarded";
  timer: ReturnType<typeof setTimeout> | null;
  borrows: Set<Borrow>;
};
export interface TemporaryMaterialAdmission {
  readonly reference: Readonly<TemporaryMaterialReference>;
  /** Verification may read staged bytes; ordinary reads cannot see an unverified material. */
  verify<T>(run: (bytes: Uint8Array, signal: AbortSignal) => Promise<T>): Promise<T>;
  publish(): void;
  discard(): void;
}

/**
 * Owning durable control consumes the ORIGINAL generation's completion once. It verifies exact
 * owner/application/generation/hash/time metadata and never accepts a refreshed retry timestamp.
 * Already-completed work cannot restore lost process memory; recovery is metadata/read-only.
 */
export interface TemporaryMaterialCompletionAuthority {
  claimOriginalCompletion(
    reference: Readonly<TemporaryMaterialReference>,
  ): Promise<"claimed" | "already_completed" | "unavailable">;
}

/**
 * Process-local content, with no SQL/object/provider/reconstruction capability. Capacity includes
 * managed borrowed byte copies. Discard tombstones retain identifiers only until the original
 * deadline, preventing cancellation/retry from restoring content in that window.
 * The original durable dispatch authority must prohibit a second completion/generation under
 * the same ID across restarts. This store never grants dispatch or certifies remote settlement.
 */
export class TemporaryMaterialStore {
  #entries = new Map<string, Entry>();
  #bytes = 0;
  #borrows = 0;
  #closed = false;
  #lastWall = -Infinity;
  #lastMonotonic = -Infinity;
  readonly #wallNow: () => number;
  readonly #monotonicNow: () => number;
  readonly #maximumBytes: number;
  readonly #maximumMaterialBytes: number;
  readonly #maximumEntries: number;
  readonly #maximumBorrows: number;

  constructor(
    options: {
      wallNow?: () => number;
      monotonicNow?: () => number;
      maximumBytes?: number;
      maximumMaterialBytes?: number;
      maximumEntries?: number;
      maximumBorrows?: number;
    } = {},
  ) {
    const limit = (value: number | undefined, maximum: number) => {
      const actual = value ?? maximum;
      if (!Number.isSafeInteger(actual) || actual < 1 || actual > maximum)
        throw new TemporaryMaterialUnavailable();
      return actual;
    };
    this.#wallNow = options.wallNow ?? Date.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#maximumBytes = limit(options.maximumBytes, MAX_BYTES);
    this.#maximumMaterialBytes = limit(options.maximumMaterialBytes, MAX_MATERIAL_BYTES);
    this.#maximumEntries = limit(options.maximumEntries, MAX_ENTRIES);
    this.#maximumBorrows = limit(options.maximumBorrows, MAX_BORROWS);
  }

  stage(reference: TemporaryMaterialReference, bytes: Uint8Array): TemporaryMaterialAdmission {
    const ref = this.#reference(reference);
    const now = this.#now();
    this.sweep();
    if (
      now.wall < ref.completedAtMs ||
      now.wall >= ref.expiresAtMs ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > this.#maximumMaterialBytes ||
      this.#entries.has(ref.generationId) ||
      this.#entries.size >= this.#maximumEntries ||
      this.#bytes + bytes.byteLength > this.#maximumBytes
    )
      throw new TemporaryMaterialUnavailable();
    const entry: Entry = {
      reference: Object.freeze(ref),
      bytes: Uint8Array.from(bytes),
      bytesHash: createHash("sha256").update(bytes).digest("hex"),
      monotonicExpiry: now.monotonic + ref.expiresAtMs - now.wall,
      state: "pending",
      timer: null,
      borrows: new Set(),
    };
    this.#entries.set(ref.generationId, entry);
    this.#bytes += entry.bytes.byteLength;
    this.#schedule(entry);
    return Object.freeze({
      reference: entry.reference,
      verify: <T>(run: (bytes: Uint8Array, signal: AbortSignal) => Promise<T>) =>
        this.#borrow(entry, "pending", run),
      publish: () => {
        this.#require(entry, "pending");
        if (entry.borrows.size) throw new TemporaryMaterialUnavailable();
        entry.state = "ready";
      },
      discard: () => this.#discard(entry),
    });
  }

  has(reference: TemporaryMaterialReference): boolean {
    const entry = this.#find(reference);
    return entry?.state === "ready";
  }

  async withMaterial<T>(
    reference: TemporaryMaterialReference,
    run: (bytes: Uint8Array, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const entry = this.#find(reference);
    if (!entry) throw new TemporaryMaterialUnavailable();
    return this.#borrow(entry, "ready", run);
  }

  discard(reference: TemporaryMaterialReference): void {
    const entry = this.#find(reference);
    if (entry) this.#discard(entry);
  }

  discardApplication(ownerUserId: string, applicationId: string): void {
    if (
      typeof ownerUserId !== "string" ||
      typeof applicationId !== "string" ||
      !UUID.test(ownerUserId) ||
      !UUID.test(applicationId)
    )
      throw new TemporaryMaterialUnavailable();
    for (const entry of this.#entries.values())
      if (
        entry.reference.ownerUserId === ownerUserId &&
        entry.reference.applicationId === applicationId
      )
        this.#discard(entry);
  }

  discardOwner(ownerUserId: string): void {
    if (typeof ownerUserId !== "string" || !UUID.test(ownerUserId))
      throw new TemporaryMaterialUnavailable();
    for (const entry of this.#entries.values())
      if (entry.reference.ownerUserId === ownerUserId) this.#discard(entry);
  }

  sweep(): void {
    const now = this.#now();
    for (const entry of this.#entries.values())
      if (this.#remaining(entry, now) <= 0) {
        this.#discard(entry);
        this.#entries.delete(entry.reference.generationId);
      }
  }

  dispose(): void {
    this.#closed = true;
    for (const entry of this.#entries.values()) {
      this.#discard(entry);
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#entries.clear();
  }

  #reference(reference: TemporaryMaterialReference): TemporaryMaterialReference {
    if (!validateTemporaryMaterialReference(reference)) throw new TemporaryMaterialUnavailable();
    return { ...reference };
  }

  #now() {
    let wall: number;
    let monotonic: number;
    try {
      wall = this.#wallNow();
      monotonic = this.#monotonicNow();
    } catch {
      this.dispose();
      throw new TemporaryMaterialUnavailable();
    }
    if (
      this.#closed ||
      !Number.isSafeInteger(wall) ||
      !Number.isFinite(monotonic) ||
      wall < this.#lastWall ||
      monotonic < this.#lastMonotonic
    ) {
      this.dispose();
      throw new TemporaryMaterialUnavailable();
    }
    this.#lastWall = wall;
    this.#lastMonotonic = monotonic;
    return { wall, monotonic };
  }

  #remaining(entry: Entry, now = this.#now()) {
    return Math.min(entry.reference.expiresAtMs - now.wall, entry.monotonicExpiry - now.monotonic);
  }

  #schedule(entry: Entry): void {
    entry.timer = setTimeout(
      () => {
        entry.timer = null;
        try {
          if (this.#remaining(entry) <= 0) {
            this.#discard(entry);
            this.#entries.delete(entry.reference.generationId);
          } else this.#schedule(entry);
        } catch {
          this.dispose();
        }
      },
      Math.max(1, Math.ceil(this.#remaining(entry))),
    );
    entry.timer.unref();
  }

  #find(reference: TemporaryMaterialReference): Entry | undefined {
    const ref = this.#reference(reference);
    this.sweep();
    const entry = this.#entries.get(ref.generationId);
    if (!entry || !sameTemporaryMaterialReference(ref, entry.reference)) return undefined;
    return entry.state === "discarded" ? undefined : entry;
  }

  #require(entry: Entry, state: "pending" | "ready"): void {
    if (this.#remaining(entry) <= 0) this.#discard(entry);
    if (this.#entries.get(entry.reference.generationId) !== entry || entry.state !== state)
      throw new TemporaryMaterialUnavailable();
  }

  #discard(entry: Entry): void {
    if (entry.state === "discarded") return;
    entry.state = "discarded";
    this.#bytes -= entry.bytes.byteLength;
    entry.bytes.fill(0);
    entry.bytes = new Uint8Array();
    for (const borrow of entry.borrows) {
      if (borrow.bytes.byteLength) borrow.bytes.fill(0);
      borrow.controller.abort(new TemporaryMaterialUnavailable());
    }
  }

  async #borrow<T>(
    entry: Entry,
    state: "pending" | "ready",
    run: (bytes: Uint8Array, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.#require(entry, state);
    if (
      this.#borrows >= this.#maximumBorrows ||
      this.#bytes + entry.bytes.byteLength > this.#maximumBytes
    )
      throw new TemporaryMaterialUnavailable();
    const borrow = {
      bytes: Uint8Array.from(entry.bytes),
      sizeBytes: entry.bytes.byteLength,
      controller: new AbortController(),
    };
    entry.borrows.add(borrow);
    this.#borrows++;
    this.#bytes += borrow.bytes.byteLength;
    try {
      const result = await run(borrow.bytes, borrow.controller.signal);
      this.#require(entry, state);
      if (
        borrow.controller.signal.aborted ||
        createHash("sha256").update(borrow.bytes).digest("hex") !== entry.bytesHash
      )
        throw new TemporaryMaterialUnavailable();
      return result;
    } catch {
      // Do not leak decoder/renderer failures containing content or attacker-controlled errors.
      throw new TemporaryMaterialUnavailable();
    } finally {
      this.#bytes -= borrow.sizeBytes;
      this.#borrows--;
      if (borrow.bytes.byteLength) borrow.bytes.fill(0);
      entry.borrows.delete(borrow);
    }
  }
}
