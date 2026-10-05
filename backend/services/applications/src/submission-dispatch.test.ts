import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { assemblePacket } from "./packet.js";
import {
  type ApplicationStorePort,
  ApplicationsService,
  type LiveBindingsSource,
} from "./service.js";
import {
  ApplicationIntegrityError,
  ApplicationNotFoundError,
  type ApplicationView,
  AttemptNotFoundError,
  PostgresApplicationStore,
  StalePacketError,
} from "./store.js";
import {
  APPLICATION_ID,
  CONSENT_ID,
  definitions,
  FACT_B,
  HASH_A,
  HASH_B,
  HASH_C,
  JOB_ID,
  NOW,
  packetInputs,
  USER_ID,
} from "./test-support.js";

function fixture() {
  const packet = assemblePacket(packetInputs(), definitions);
  const attempt = {
    id: FACT_B,
    applicationId: APPLICATION_ID,
    packetId: packet.id,
    packetHash: packet.packetHash,
    approvalId: CONSENT_ID,
    sequence: 1,
    scopeKey: HASH_A,
    status: "started" as const,
    adapterId: "greenhouse",
    adapterVersion: "1.0.0",
    startedAt: NOW,
  };
  const view: ApplicationView = {
    application: {
      id: APPLICATION_ID,
      ownerUserId: USER_ID,
      canonicalJobId: JOB_ID,
      revision: 4,
      status: "submitting",
      currentPacketId: packet.id,
      createdAt: NOW,
      updatedAt: NOW,
    },
    currentPacket: packet,
    approval: null,
    attempts: [attempt],
    currentAction: "submission_in_progress",
  };
  const getApplication = vi.fn(async () => view);
  const dispatchAttempt = vi.fn<ApplicationStorePort["dispatchAttempt"]>(async () => ({
    ...attempt,
    status: "dispatched",
    dispatchedAt: NOW,
  }));
  const resolve = vi.fn<LiveBindingsSource["resolve"]>(async ({ formHash }) => ({
    jobRevision: HASH_A,
    formHash,
    resumeHash: HASH_C,
  }));
  const service = new ApplicationsService({
    store: { getApplication, dispatchAttempt } as unknown as ApplicationStorePort,
    bindings: { resolve },
    packets: {
      prepare: async () => {
        throw Error("SyntheticUnexpectedPreparation");
      },
    },
    jobs: { isActive: async () => true },
  });
  return { service, getApplication, dispatchAttempt, resolve, view };
}

describe("submission write-ahead dispatch owner bindings", () => {
  it("refuses a legacy internal caller without a binding snapshot before SQL", async () => {
    const begin = vi.fn();
    const store = new PostgresApplicationStore({ begin } as unknown as postgres.Sql, () => NOW, {
      definitions,
    });
    await expect(
      store.dispatchAttempt({
        ownerUserId: USER_ID,
        applicationId: APPLICATION_ID,
        attemptId: FACT_B,
      } as Parameters<PostgresApplicationStore["dispatchAttempt"]>[0]),
    ).rejects.toBeInstanceOf(ApplicationIntegrityError);
    expect(begin).not.toHaveBeenCalled();
  });
  it("resolves current owner bindings before requesting a dispatch receipt", async () => {
    const f = fixture();
    await expect(f.service.dispatchAttempt(USER_ID, APPLICATION_ID, FACT_B)).resolves.toMatchObject(
      { status: "dispatched" },
    );
    expect(f.getApplication).toHaveBeenCalledWith(USER_ID, APPLICATION_ID);
    expect(f.resolve).toHaveBeenCalledWith({
      ownerUserId: USER_ID,
      application: f.view.application,
      formHash: HASH_B,
    });
    expect(f.dispatchAttempt).toHaveBeenCalledWith({
      ownerUserId: USER_ID,
      applicationId: APPLICATION_ID,
      attemptId: FACT_B,
      current: { jobRevision: HASH_A, formHash: HASH_B, resumeHash: HASH_C },
    });
    expect(f.getApplication.mock.invocationCallOrder[0]).toBeLessThan(
      f.resolve.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      f.dispatchAttempt.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("withholds dispatch when an owner binding cannot be read", async () => {
    const f = fixture();
    const unavailable = Error("SyntheticOwnerUnavailable");
    f.resolve.mockRejectedValueOnce(unavailable);
    await expect(f.service.dispatchAttempt(USER_ID, APPLICATION_ID, FACT_B)).rejects.toBe(
      unavailable,
    );
    expect(f.dispatchAttempt).not.toHaveBeenCalled();
  });

  it("rejects an absent or foreign application before reading candidate bindings", async () => {
    const f = fixture();
    f.getApplication.mockRejectedValueOnce(new ApplicationNotFoundError());
    await expect(f.service.dispatchAttempt(USER_ID, APPLICATION_ID, FACT_B)).rejects.toBeInstanceOf(
      ApplicationNotFoundError,
    );
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.dispatchAttempt).not.toHaveBeenCalled();
  });

  it("passes changed artifact bindings to the owning transactional refusal", async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce({
      jobRevision: HASH_A,
      formHash: HASH_B,
      resumeHash: HASH_A,
      coverLetterHash: HASH_C,
    });
    const stale = new StalePacketError(["resume_changed", "cover_letter_changed"]);
    f.dispatchAttempt.mockRejectedValueOnce(stale);
    await expect(f.service.dispatchAttempt(USER_ID, APPLICATION_ID, FACT_B)).rejects.toBe(stale);
    expect(f.dispatchAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        current: {
          jobRevision: HASH_A,
          formHash: HASH_B,
          resumeHash: HASH_A,
          coverLetterHash: HASH_C,
        },
      }),
    );
  });

  it("refuses an absent or foreign attempt before any private binding read", async () => {
    const f = fixture();
    f.view.attempts = [];
    await expect(f.service.dispatchAttempt(USER_ID, APPLICATION_ID, FACT_B)).rejects.toBeInstanceOf(
      AttemptNotFoundError,
    );
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.dispatchAttempt).not.toHaveBeenCalled();
  });
});
