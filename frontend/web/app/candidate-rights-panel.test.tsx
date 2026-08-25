// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateRightsPanel } from "./candidate-rights-panel";

const exportId = "019c2b89-79b2-7000-8000-000000000004";
const deletionRequestId = "019c2b89-79b2-7000-8000-000000000005";
const baseExport = {
  id: exportId,
  schemaVersion: 1,
  format: "candidate-data-export-v1",
  policyVersion: "policy-2026-08",
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};
const requestedDeletion = {
  id: deletionRequestId,
  schemaVersion: 1,
  policyVersion: "policy-2026-08",
  state: "requested",
  version: 1,
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const candidate = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!candidate) throw new Error(`Missing button: ${label}`);
  return candidate;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await act(async () => undefined);
}

describe("CandidateRightsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "019c2b89-79b2-7000-8000-000000000099",
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders no candidate-rights controls outside an authenticated session", async () => {
    await act(async () => root.render(<CandidateRightsPanel authenticated={false} />));
    expect(container.textContent).toBe("");
  });

  it("requests, checks, and exposes only a contract-valid bounded export grant", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...baseExport, state: "queued" }))
      .mockResolvedValueOnce(
        Response.json({
          export: {
            ...baseExport,
            state: "ready",
            updatedAt: "2026-08-25T12:00:01.000Z",
            artifactExpiresAt: "2026-08-25T13:00:00.000Z",
          },
          download: {
            url: "https://exports.example.test/exact-object?signature=synthetic",
            method: "GET",
            expiresAt: "2026-08-25T12:05:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CandidateRightsPanel authenticated />));

    await click(button(container, "Request my data export"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/platform/data-exports");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      format: "candidate-data-export-v1",
    });
    await click(button(container, "Check export status"));

    const download = container.querySelector<HTMLAnchorElement>("a[download]");
    expect(download?.href).toBe("https://exports.example.test/exact-object?signature=synthetic");
    expect(download?.rel).toBe("noreferrer");
    expect(container.textContent).not.toContain("signature=synthetic");
  });

  it("requires two explicit deletion steps and permits cancellation before confirmation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(requestedDeletion))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CandidateRightsPanel authenticated />));

    const start = button(container, "Start account deletion");
    expect(start.disabled).toBe(true);
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Missing acknowledgement checkbox");
    await click(checkbox);
    const enabledStart = button(container, "Start account deletion");
    expect(enabledStart.disabled).toBe(false);
    await click(enabledStart);

    expect(container.textContent).toContain("not confirmed");
    expect(button(container, "Permanently delete my account").disabled).toBe(true);
    await click(button(container, "Cancel deletion request"));

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("if-match")).toBe('"1"');
    expect(container.textContent).toContain("was cancelled");
  });

  it("requires the exact typed phrase before irreversible confirmation", async () => {
    const confirmed = {
      ...requestedDeletion,
      state: "quarantined",
      version: 2,
      confirmedAt: "2026-08-25T12:01:00.000Z",
      backupExpiresAt: "2026-09-01T12:01:00.000Z",
      updatedAt: "2026-08-25T12:01:00.000Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(requestedDeletion))
      .mockResolvedValueOnce(Response.json(confirmed));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CandidateRightsPanel authenticated />));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Missing acknowledgement checkbox");
    await click(checkbox);
    await click(button(container, "Start account deletion"));

    const confirmation = container.querySelector<HTMLInputElement>('input[autocomplete="off"]');
    if (!confirmation) throw new Error("Missing confirmation input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(confirmation, "DELETE_MY_ACCOUNT");
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const permanent = button(container, "Permanently delete my account");
    expect(permanent.disabled).toBe(false);
    await click(permanent);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/platform/account-deletion-requests/${deletionRequestId}/confirm`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedVersion: 1,
      confirmation: "DELETE_MY_ACCOUNT",
    });
    expect(container.textContent).toContain("quarantined");
  });
});
