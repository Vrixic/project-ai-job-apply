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

  it.each([
    ["uphold", "upheld"],
    ["reverse", "reversed"],
  ])(
    "narrows the appeal queue and sends only an evidence-bound %s appeal decision",
    async (action, outcome) => {
      await act(async () =>
        root.render(React.createElement(TrustConsole, { appealOnly: true, key: "appeals" })),
      );
      const appealedCase = { ...trustCase, state: "appeal_pending", version: 3, appealed: true };
      const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes("?")) return Response.json({ items: [appealedCase] });
        if (url.endsWith("/evidence")) return Response.json({ ...evidence, caseVersion: 3 });
        return Response.json(appealedCase);
      });
      vi.stubGlobal("fetch", fetcher);
      const queue = container.querySelector<HTMLSelectElement>("#trust-queue-state");
      expect(queue?.value).toBe("appeal_pending");
      expect(Array.from(queue?.options ?? []).map((option) => option.value)).toEqual([
        "appeal_pending",
      ]);
      expect(container.querySelector("#trust-contribution-id")).toBeNull();
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
      expect(container.textContent).not.toContain("Open review case");
      expect(container.textContent).not.toContain("Accept independently verified");
      expect(container.textContent).not.toContain("Take down:");

      await act(async () => button("Load review queue").click());
      expect(fetcher.mock.calls[0]?.[0]).toBe("/api/trust/cases?state=appeal_pending&pageSize=25");
      await act(async () => button("Review case and evidence").click());
      const select = container.querySelector<HTMLSelectElement>("#trust-action");
      expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
        "uphold",
        "reverse",
      ]);
      const digest = container.querySelector<HTMLInputElement>("#trust-evidence-digest");
      if (!select || !digest) throw new Error("Missing synthetic appeal controls");
      expect(digest.required).toBe(true);
      expect(digest.disabled).toBe(false);
      expect(digest.value).toBe("");
      digest.value = "b".repeat(64);
      await act(async () => {
        select.value = action;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        button("Record version-fenced decision")
          .closest("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
      expect(writes).toHaveLength(1);
      expect(writes[0]?.[0]).toBe(`/api/trust/cases/${trustCase.id}/appeal-resolution`);
      expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual({
        expectedVersion: 3,
        outcome,
        evidenceDigestSha256: "b".repeat(64),
      });
    },
  );

  it("refuses a forged non-appeal action without sending a request", async () => {
    await act(async () =>
      root.render(React.createElement(TrustConsole, { appealOnly: true, key: "appeals" })),
    );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const action = container.querySelector<HTMLSelectElement>("#trust-action");
    if (!action) throw new Error("Missing synthetic appeal action");
    const forgedOption = document.createElement("option");
    forgedOption.value = "accept";
    action.append(forgedOption);
    action.value = "accept";
    await act(async () => {
      button("Record version-fenced decision")
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This profile supports appeal decisions only.");
  });

  it("does not decide a non-appeal case through the appeal profile", async () => {
    await act(async () =>
      root.render(React.createElement(TrustConsole, { appealOnly: true, key: "appeals" })),
    );
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("?")) return Response.json({ items: [trustCase] });
      if (url.endsWith("/evidence")) return Response.json(evidence);
      return Response.json(trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => button("Load review queue").click());
    await act(async () => button("Review case and evidence").click());
    expect(button("Record version-fenced decision").disabled).toBe(true);
    fetcher.mockClear();
    await act(async () => {
      button("Record version-fenced decision")
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Load a case awaiting independent appeal review before deciding.",
    );
  });
});
