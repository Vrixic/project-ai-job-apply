import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as confirmDeletion } from "../app/api/platform/account-deletion-requests/[deletionRequestId]/confirm/route";
import {
  DELETE as cancelDeletion,
  GET as getDeletion,
} from "../app/api/platform/account-deletion-requests/[deletionRequestId]/route";
import { POST as createDeletion } from "../app/api/platform/account-deletion-requests/route";
import { GET as getExport } from "../app/api/platform/data-exports/[dataExportId]/route";
import { POST as createExport } from "../app/api/platform/data-exports/route";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
  getAuth0Client: vi.fn(() => ({ synthetic: "auth0-client" })),
}));

vi.mock("./platform-api", () => ({ forwardPlatformRequest: mocks.forwardPlatformRequest }));
vi.mock("./auth0", () => ({ getAuth0Client: mocks.getAuth0Client }));

const exportId = "019c2b89-79b2-7000-8000-000000000004";
const deletionRequestId = "019c2b89-79b2-7000-8000-000000000005";
const idempotencyKey = "candidate-rights-test-0001";
const candidateExport = {
  id: exportId,
  schemaVersion: 1,
  format: "candidate-data-export-v1",
  policyVersion: "policy-2026-08",
  state: "queued",
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};
const deletion = {
  id: deletionRequestId,
  schemaVersion: 1,
  policyVersion: "policy-2026-08",
  state: "requested",
  version: 1,
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};

beforeEach(() => vi.clearAllMocks());

describe("candidate-rights BFF routes", () => {
  it("validates and forwards export creation and exact access reads", async () => {
    mocks.forwardPlatformRequest
      .mockResolvedValueOnce(Response.json(candidateExport, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ export: candidateExport }, { status: 200 }));
    const created = await createExport(
      new Request("https://app.example.test/api/platform/data-exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ format: "candidate-data-export-v1" }),
      }),
    );
    expect(created.status).toBe(202);
    expect(mocks.forwardPlatformRequest.mock.calls[0]?.[0]).toBe("/v1/me/data-exports");
    expect(mocks.forwardPlatformRequest.mock.calls[0]?.[2]).toMatchObject({
      includeReauthenticationProof: true,
    });

    const accessed = await getExport(
      new Request(`https://app.example.test/api/platform/data-exports/${exportId}`),
      { params: Promise.resolve({ dataExportId: exportId }) },
    );
    expect(accessed.status).toBe(200);
    expect(mocks.forwardPlatformRequest.mock.calls[1]?.[0]).toBe(`/v1/me/data-exports/${exportId}`);
  });

  it("enforces the two-step deletion contract and exact cancellation headers", async () => {
    mocks.forwardPlatformRequest
      .mockResolvedValueOnce(Response.json(deletion, { status: 201 }))
      .mockResolvedValueOnce(Response.json(deletion, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            ...deletion,
            state: "quarantined",
            version: 2,
            confirmedAt: "2026-08-25T12:01:00.000Z",
            backupExpiresAt: "2026-09-01T12:01:00.000Z",
            updatedAt: "2026-08-25T12:01:00.000Z",
          },
          { status: 202 },
        ),
      );
    const created = await createDeletion(
      new Request("https://app.example.test/api/platform/account-deletion-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ acknowledgement: "ACCOUNT_DELETION_IS_IRREVERSIBLE" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(mocks.forwardPlatformRequest.mock.calls[0]?.[2]).toMatchObject({
      includeReauthenticationProof: true,
    });

    const context = { params: Promise.resolve({ deletionRequestId }) };
    expect(
      (
        await getDeletion(
          new Request(
            `https://app.example.test/api/platform/account-deletion-requests/${deletionRequestId}`,
          ),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await cancelDeletion(
          new Request(
            `https://app.example.test/api/platform/account-deletion-requests/${deletionRequestId}`,
            {
              method: "DELETE",
              headers: { "idempotency-key": idempotencyKey, "if-match": '"1"' },
            },
          ),
          context,
        )
      ).status,
    ).toBe(204);
    expect(mocks.forwardPlatformRequest.mock.calls[2]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "idempotency-key": idempotencyKey, "if-match": '"1"' },
    });
    expect(mocks.forwardPlatformRequest.mock.calls[2]?.[2]).toMatchObject({
      includeReauthenticationProof: true,
    });

    const confirmed = await confirmDeletion(
      new Request(
        `https://app.example.test/api/platform/account-deletion-requests/${deletionRequestId}/confirm`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ expectedVersion: 1, confirmation: "DELETE_MY_ACCOUNT" }),
        },
      ),
      context,
    );
    expect(confirmed.status).toBe(202);
    expect(mocks.forwardPlatformRequest.mock.calls[3]?.[0]).toBe(
      `/v1/me/account-deletion-requests/${deletionRequestId}/confirm`,
    );
    expect(mocks.forwardPlatformRequest.mock.calls[3]?.[2]).toMatchObject({
      includeReauthenticationProof: true,
    });
  });

  it("rejects query strings, malformed identifiers, and weak preconditions locally", async () => {
    const badRead = await getExport(
      new Request(`https://app.example.test/api/platform/data-exports/${exportId}?unexpected=true`),
      { params: Promise.resolve({ dataExportId: exportId }) },
    );
    const badDelete = await cancelDeletion(
      new Request("https://app.example.test/api/platform/account-deletion-requests/not-a-uuid", {
        method: "DELETE",
        headers: { "idempotency-key": "short", "if-match": "1" },
      }),
      { params: Promise.resolve({ deletionRequestId: "not-a-uuid" }) },
    );
    expect(badRead.status).toBe(400);
    expect(badDelete.status).toBe(400);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
