import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import { PostgresBillingStore } from "./store.js";

const occurredAt = new Date("2026-08-15T12:00:00.000Z");

function validCommand() {
  return {
    userId: uuidv7(),
    expectedVersion: 0,
    idempotencyKey: "entitlement-command-0001",
    grant: {
      plan: "pro" as const,
      effectiveAt: occurredAt,
      accessThrough: new Date("2026-09-15T12:00:00.000Z"),
    },
    reasonCode: "synthetic_grant" as const,
    actor: { kind: "system" as const, reference: uuidv7() },
    occurredAt,
    traceId: uuidv7(),
  };
}

describe("PostgresBillingStore input boundary", () => {
  const store = new PostgresBillingStore({} as postgres.Sql);

  it("rejects provider payload fields before touching persistence", async () => {
    await expect(
      store.applyEntitlementChange({
        ...validCommand(),
        provider: "stripe",
      } as never),
    ).rejects.toThrow("unexpected field boundary");
    await expect(
      store.applyEntitlementChange({
        ...validCommand(),
        grant: { ...validCommand().grant, price: 19 },
      } as never),
    ).rejects.toThrow("unexpected field boundary");
  });

  it("rejects malformed schedules, identifiers, clocks, and idempotency keys", async () => {
    await expect(
      store.applyEntitlementChange({ ...validCommand(), userId: "not-a-user" }),
    ).rejects.toThrow("userId must be a canonical lowercase UUID");
    await expect(
      store.applyEntitlementChange({ ...validCommand(), idempotencyKey: "short" }),
    ).rejects.toThrow("idempotency key is invalid");
    await expect(
      store.applyEntitlementChange({
        ...validCommand(),
        grant: { ...validCommand().grant, accessThrough: occurredAt },
      }),
    ).rejects.toThrow("must follow effectiveAt");
    await expect(
      store.applyEntitlementChange({ ...validCommand(), occurredAt: new Date(Number.NaN) }),
    ).rejects.toThrow("occurredAt is invalid");
    await expect(
      store.applyEntitlementChange({
        ...validCommand(),
        grant: {
          ...validCommand().grant,
          effectiveAt: new Date("2026-08-15T12:00:00.001Z"),
        },
      }),
    ).rejects.toThrow("cannot be future-effective");
    await expect(
      store.applyEntitlementChange({
        ...validCommand(),
        grant: { plan: "free", effectiveAt: new Date("2026-08-15T12:00:00.001Z") },
        reasonCode: "synthetic_revoke",
      }),
    ).rejects.toThrow("cannot be future-effective");
  });

  it("rejects case-variant identifiers before persistence", async () => {
    const input = validCommand();
    await expect(
      store.applyEntitlementChange({ ...input, userId: input.userId.toUpperCase() }),
    ).rejects.toThrow("userId must be a canonical lowercase UUID");
    await expect(
      store.applyEntitlementChange({
        ...input,
        actor: { ...input.actor, reference: input.actor.reference.toUpperCase() },
      }),
    ).rejects.toThrow("actor.reference must be a canonical lowercase UUID");
    await expect(
      store.applyEntitlementChange({ ...input, traceId: input.traceId.toUpperCase() }),
    ).rejects.toThrow("traceId must be a canonical lowercase UUID");
  });

  it("rejects contradictory audit actor and reason pairs before persistence", async () => {
    const input = validCommand();
    await expect(
      store.applyEntitlementChange({
        ...input,
        reasonCode: "support_adjustment",
        actor: { kind: "provider_adapter", reference: input.actor.reference },
      } as never),
    ).rejects.toThrow("actor and reason do not match");
    await expect(
      store.applyEntitlementChange({
        ...input,
        reasonCode: "provider_projection",
        actor: { kind: "support", reference: input.actor.reference },
      } as never),
    ).rejects.toThrow("actor and reason do not match");
    await expect(
      store.applyEntitlementChange({
        ...input,
        reasonCode: "synthetic_revoke",
      } as never),
    ).rejects.toThrow("actor and reason do not match");
    await expect(
      store.applyEntitlementChange({
        ...input,
        grant: { plan: "free", effectiveAt: input.grant.effectiveAt },
      } as never),
    ).rejects.toThrow("actor and reason do not match");
  });

  it("rejects malformed claimed event rows before returning them", async () => {
    const accountId = uuidv7();
    const userId = uuidv7();
    const baseRow = {
      id: uuidv7(),
      subject: `entitlement-account/${accountId}`,
      payload: { entitlementAccountId: accountId, userId, version: 1 },
      occurredAt,
      attemptCount: 1,
    };
    const malformedRows = [
      { ...baseRow, payload: { ...baseRow.payload, version: Number.MAX_SAFE_INTEGER + 1 } },
      { ...baseRow, subject: `entitlement-account/${uuidv7()}` },
      { ...baseRow, payload: { ...baseRow.payload, userId: userId.toUpperCase() } },
      { ...baseRow, attemptCount: 0 },
    ];
    for (const row of malformedRows) {
      const client = vi.fn(async () => [row]) as unknown as postgres.Sql;
      const claimStore = new PostgresBillingStore(client);
      await expect(
        claimStore.claimOutbox({ now: occurredAt, limit: 1, leaseMilliseconds: 1_000 }),
      ).rejects.toThrow();
    }
  });
});
