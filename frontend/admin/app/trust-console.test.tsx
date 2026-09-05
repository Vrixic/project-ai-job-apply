// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustConsole } from "./trust-console";

const trustCase = {
  id: "019d04cf-1f80-8000-8000-000000000010",
  contributionId: "019d04cf-1f80-7000-8000-000000000011",
  version: 1,
  state: "needs_review",
  appealed: false,
  policyVersion: "synthetic-v1",
  createdAt: "2026-09-05T12:00:00.000Z",
  updatedAt: "2026-09-05T12:00:00.000Z",
};
const evidence = {
  caseId: trustCase.id,
  caseVersion: 1,
  evidence: {
    contributionId: trustCase.contributionId,
    evidenceDigestSha256: "a".repeat(64),
    verifiedAt: trustCase.createdAt,
    provider: "greenhouse",
    sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
    title: "Synthetic role",
    companyName: "Synthetic company",
    description: "Complete verified description\nFinal sentence must remain visible.",
    locations: ["Remote"],
  },
};
let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  if (!result) throw new Error(`Missing test control ${text}`);
  return result;
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(TrustConsole)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("interactive Trust reviewer console", () => {
  it("loads a queue, displays full evidence and submits the loaded version/digest without manual copying", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("?")) return Response.json({ items: [trustCase] });
      if (url.endsWith("/evidence")) return Response.json(evidence);
      if (url.endsWith("/decision")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          expectedVersion: 1,
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256: evidence.evidence.evidenceDigestSha256,
        });
      }
      return Response.json(trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    expect(button("Record version-fenced decision").disabled).toBe(true);
    await act(async () => button("Load review queue").click());
    await act(async () => button("Review case and evidence").click());
    expect(container.querySelector("pre")?.textContent).toBe(evidence.evidence.description);
    expect(container.textContent).toContain("Synthetic company");
    expect(container.querySelector<HTMLInputElement>("#trust-action-case-id")?.readOnly).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#trust-action-version")?.value).toBe("1");
    expect(button("Record version-fenced decision").disabled).toBe(false);
    await act(async () => {
      button("Record version-fenced decision")
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/decision"))).toHaveLength(1);
    expect(container.textContent).not.toContain("contributorUserId");
  });

  it("keeps decisions disabled when readable evidence is absent or version mismatched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("?")) return Response.json({ items: [trustCase] });
        if (url.endsWith("/evidence")) return Response.json({ ...evidence, caseVersion: 2 });
        return Response.json(trustCase);
      }),
    );
    await act(async () => button("Load review queue").click());
    await act(async () => button("Review case and evidence").click());
    expect(button("Record version-fenced decision").disabled).toBe(true);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain(
      "The case changed. Reload it before reviewing evidence.",
    );
  });
});
