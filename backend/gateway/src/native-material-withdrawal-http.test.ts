import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { expect, it, vi } from "vitest";
import {
  createSyntheticAssuranceApplication,
  SYNTHETIC_OWNER_A,
  SYNTHETIC_OWNER_B,
} from "./d1-api-assurance-test-support.js";

it("authenticates owner-scoped withdrawal without accepting owner, task or query input", async () => {
  const requestId = "019d04cf-1f80-7000-8000-000000000002";
  const status = { requestId, requestedAt: "2026-10-08T12:00:00.000Z", state: "pending" as const };
  const create = vi.fn(async (_owner: string, _request: string) => status);
  const get = vi.fn(async (owner: string) => (owner === SYNTHETIC_OWNER_A ? status : null));
  const f = await createSyntheticAssuranceApplication({
    nativeMaterialWithdrawals: { create, get },
  });
  try {
    const write = await f.issuer.issue("synthetic-candidate-a", { scope: "applications:write" });
    const read = await f.issuer.issue("synthetic-candidate-a", { scope: "applications:read" });
    const foreign = await f.issuer.issue("synthetic-candidate-b", { scope: "applications:read" });
    const url = `/v1/material-withdrawals/${requestId}`;
    expect((await f.app.inject({ method: "PUT", url })).statusCode).toBe(401);
    expect(
      (await f.app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${read}` } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url,
          headers: { authorization: `Bearer ${write}` },
          payload: { ownerUserId: SYNTHETIC_OWNER_B },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: `${url}?owner=other`,
          headers: { authorization: `Bearer ${write}` },
        })
      ).statusCode,
    ).toBe(400);
    expect(create).not.toHaveBeenCalled();
    const accepted = await f.app.inject({
      method: "PUT",
      url,
      headers: { authorization: `Bearer ${write}` },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(compileComponentValidator("NativeMaterialWithdrawal")(accepted.json())).toBe(true);
    expect(create).toHaveBeenCalledExactlyOnceWith(SYNTHETIC_OWNER_A, requestId);
    expect(
      (await f.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${foreign}` } }))
        .statusCode,
    ).toBe(404);
    expect(get).toHaveBeenCalledExactlyOnceWith(SYNTHETIC_OWNER_B, requestId);
    create.mockRejectedValueOnce(Error("synthetic-private-task-token"));
    const failure = await f.app.inject({
      method: "PUT",
      url,
      headers: { authorization: `Bearer ${write}` },
    });
    expect(failure.statusCode).toBe(503);
    expect(failure.body).not.toContain("synthetic-private-task-token");
  } finally {
    await f.app.close();
  }
});
