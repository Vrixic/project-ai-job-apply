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

function control<T extends HTMLInputElement | HTMLSelectElement>(selector: string): T {
  const result = container.querySelector<T>(selector);
  if (!result) throw new Error(`Missing generated control ${selector}`);
  return result;
}

async function enter(selector: string, value: string) {
  await act(async () => {
    const input = control<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function select(selector: string, value: string) {
  await act(async () => {
    const input = control<HTMLSelectElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function submit(text: string) {
  button(text)
    .closest("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function loadCase(id = trustCase.id) {
  await enter("#trust-case-id", id);
  await act(async () => submit("Load Trust case"));
}

function evidenceFor(value: typeof trustCase) {
  return {
    ...evidence,
    caseId: value.id,
    caseVersion: value.version,
    evidence: { ...evidence.evidence, contributionId: value.contributionId },
  };
}

function deferredResponse() {
  let resolve: (value: Response) => void = () => {
    throw new Error("Generated response is not initialized");
  };
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function enterTakedownDraft() {
  await select("#trust-action", "takedown");
  await enter("#trust-evidence-digest", "b".repeat(64));
  await act(async () => control<HTMLInputElement>('input[type="checkbox"]').click());
}

function expectEmptyReview() {
  expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe("");
  expect(control<HTMLInputElement>("#trust-action-version").value).toBe("");
  expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("");
  expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
  expect(container.querySelector("pre")).toBeNull();
  expect(button("Record version-fenced decision").disabled).toBe(true);
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
      await act(async () => {
        select.value = action;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await enter("#trust-evidence-digest", "b".repeat(64));
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

  it.each(["case", "version"])(
    "clears the manual draft when the loaded %s changes",
    async (kind) => {
      let current = { ...trustCase, state: "accepted" };
      const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
        Response.json(url.endsWith("/evidence") ? evidenceFor(current) : current),
      );
      vi.stubGlobal("fetch", fetcher);
      await loadCase();
      await enterTakedownDraft();
      expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("b".repeat(64));
      current = {
        ...current,
        ...(kind === "case"
          ? {
              id: "019d04cf-1f80-8000-8000-000000000012",
              contributionId: "019d04cf-1f80-7000-8000-000000000013",
            }
          : { version: 2 }),
      };
      await loadCase(current.id);
      expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe(current.id);
      expect(control<HTMLInputElement>("#trust-action-version").value).toBe(
        String(current.version),
      );
      expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("");
      expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
      await act(async () => submit("Record version-fenced decision"));
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    },
  );

  it("invalidates the selected case, evidence and draft when the queue filter changes", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(url.endsWith("/evidence") ? evidence : trustCase),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await enterTakedownDraft();
    await select("#trust-queue-state", "appeal_pending");
    expectEmptyReview();
    await act(async () => submit("Record version-fenced decision"));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("requires a new takedown confirmation after the manual evidence changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => Response.json(url.endsWith("/evidence") ? evidence : trustCase)),
    );
    await loadCase();
    await enterTakedownDraft();
    await enter("#trust-evidence-digest", "c".repeat(64));
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
    expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe(trustCase.id);
  });

  it.each([
    ["takedown", "uphold"],
    ["uphold", "takedown"],
    ["takedown", "accept"],
  ])("clears evidence when the decision purpose changes from %s to %s", async (before, after) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => Response.json(url.endsWith("/evidence") ? evidence : trustCase)),
    );
    await loadCase();
    await select("#trust-action", before);
    await enter("#trust-evidence-digest", "b".repeat(64));
    await act(async () => control<HTMLInputElement>('input[type="checkbox"]').click());
    await select("#trust-action", after);
    expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("");
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
    expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe(trustCase.id);
    expect(container.querySelector("pre")?.textContent).toBe(evidence.evidence.description);
  });

  it("retains reviewed appeal evidence when only its outcome changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => Response.json(url.endsWith("/evidence") ? evidence : trustCase)),
    );
    await loadCase();
    await select("#trust-action", "uphold");
    await enter("#trust-evidence-digest", "b".repeat(64));
    await select("#trust-action", "reverse");
    expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("b".repeat(64));
  });

  it("clears the complete draft even when a queue reload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("?")) return new Response(null, { status: 503 });
        return Response.json(url.endsWith("/evidence") ? evidence : trustCase);
      }),
    );
    await loadCase();
    await enterTakedownDraft();
    await act(async () => button("Load review queue").click());
    expectEmptyReview();
    expect(container.textContent).toContain("The queue could not be loaded.");
  });

  it.each(["case", "evidence"])("ignores a late %s read after a queue transition", async (part) => {
    const delayed = deferredResponse();
    const fetcher = vi.fn(async (url: string) => {
      if ((part === "evidence") === url.endsWith("/evidence")) return delayed.promise;
      return Response.json(trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await select("#trust-queue-state", "appeal_pending");
    await act(async () => delayed.resolve(Response.json(part === "case" ? trustCase : evidence)));
    expectEmptyReview();
    expect(container.textContent).not.toContain(`Case ${trustCase.id} is`);
    if (part === "case") expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer case and draft when an older case read settles last", async () => {
    const delayed = deferredResponse();
    const newer = {
      ...trustCase,
      id: "019d04cf-1f80-8000-8000-000000000012",
      contributionId: "019d04cf-1f80-7000-8000-000000000013",
    };
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith(trustCase.id)) return delayed.promise;
      return Response.json(url.endsWith("/evidence") ? evidenceFor(newer) : newer);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await loadCase(newer.id);
    await enterTakedownDraft();
    await act(async () => delayed.resolve(Response.json(trustCase)));
    expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe(newer.id);
    expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("b".repeat(64));
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(true);
    expect(
      fetcher.mock.calls.filter(([url]) => url === `/api/trust/cases/${trustCase.id}/evidence`),
    ).toHaveLength(0);
  });

  it("sends one decision despite repeated submits before React commits busy state", async () => {
    const delayed = deferredResponse();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return delayed.promise;
      return Response.json(url.endsWith("/evidence") ? evidence : trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await act(async () => {
      submit("Record version-fenced decision");
      submit("Record version-fenced decision");
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => delayed.resolve(Response.json(trustCase)));
  });

  it.each(["case", "version", "contribution", "unavailable"])(
    "does not restore an editable case after an evidence %s failure",
    async (kind) => {
      let fail = false;
      const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
        const current = { ...trustCase, version: fail ? 2 : 1 };
        if (!url.endsWith("/evidence")) return Response.json(current);
        if (!fail) return Response.json(evidenceFor(current));
        if (kind === "unavailable") return new Response(null, { status: 503 });
        const nextEvidence = evidenceFor(current);
        if (kind === "case") nextEvidence.caseId = "019d04cf-1f80-8000-8000-000000000012";
        if (kind === "version") nextEvidence.caseVersion = 1;
        if (kind === "contribution")
          nextEvidence.evidence.contributionId = "019d04cf-1f80-7000-8000-000000000013";
        return Response.json(nextEvidence);
      });
      vi.stubGlobal("fetch", fetcher);
      await loadCase();
      await enterTakedownDraft();
      fail = true;
      await loadCase();
      expectEmptyReview();
      await act(async () => submit("Record version-fenced decision"));
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    },
  );

  it.each(["decision", "open"])(
    "distinguishes an acknowledged %s from an unavailable follow-up evidence read",
    async (kind) => {
      let acknowledged = false;
      let unavailable = true;
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") acknowledged = true;
        const current = { ...trustCase, version: acknowledged ? 2 : 1 };
        if (!url.endsWith("/evidence")) return Response.json(current);
        if (acknowledged && unavailable) return new Response(null, { status: 503 });
        return Response.json(evidenceFor(current));
      });
      vi.stubGlobal("fetch", fetcher);
      if (kind === "decision") await loadCase();
      else await enter("#trust-contribution-id", trustCase.contributionId);
      await act(async () =>
        submit(kind === "decision" ? "Record version-fenced decision" : "Open review case"),
      );
      expectEmptyReview();
      expect(container.textContent).toContain(
        "The Trust operation was acknowledged, but its follow-up evidence could not be loaded.",
      );
      expect(container.textContent).toContain("Reload the case before taking another action.");
      expect(container.textContent).not.toContain("The Trust request failed.");
      await act(async () => submit("Record version-fenced decision"));
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
      unavailable = false;
      await loadCase();
      expect(control<HTMLInputElement>("#trust-action-version").value).toBe("2");
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    },
  );

  it("leaves an ambiguous write non-actionable without retrying or exposing transport details", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("generated-private-transport-detail");
      return Response.json(url.endsWith("/evidence") ? evidence : trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await act(async () => submit("Record version-fenced decision"));
    expectEmptyReview();
    expect(container.textContent).toContain(
      "The Trust operation could not be confirmed. Reload the case before taking another action.",
    );
    expect(container.textContent).not.toContain("generated-private-transport-detail");
    await act(async () => submit("Record version-fenced decision"));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not interrupt a dispatched write with a filter change or another read", async () => {
    const delayed = deferredResponse();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return delayed.promise;
      return Response.json(url.endsWith("/evidence") ? evidence : trustCase);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await act(async () => submit("Record version-fenced decision"));
    const callCount = fetcher.mock.calls.length;
    await select("#trust-queue-state", "appeal_pending");
    await loadCase();
    expect(fetcher).toHaveBeenCalledTimes(callCount);
    expect(button("Record version-fenced decision").disabled).toBe(true);
    await act(async () => delayed.resolve(Response.json(trustCase)));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(control<HTMLInputElement>("#trust-action-case-id").value).toBe(trustCase.id);
  });

  it("ignores a late queue page and cursor after its filter changes", async () => {
    const delayed = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => delayed.promise),
    );
    await act(async () => button("Load review queue").click());
    await select("#trust-queue-state", "appeal_pending");
    await act(async () =>
      delayed.resolve(Response.json({ items: [trustCase], nextCursor: "generated-cursor" })),
    );
    expectEmptyReview();
    expect(container.querySelectorAll(".case-list li")).toHaveLength(0);
    expect(container.textContent).not.toContain("Next 25 cases");
  });

  it("does not fetch evidence for an old selection after the console unmounts", async () => {
    const delayed = deferredResponse();
    const fetcher = vi.fn(() => delayed.promise);
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(React.createElement(TrustConsole)));
    await act(async () => delayed.resolve(Response.json(trustCase)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectEmptyReview();
  });

  it("does not reuse a takedown confirmation for an edit submitted before the draft state commits", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(url.endsWith("/evidence") ? evidence : trustCase),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await enterTakedownDraft();
    await act(async () => {
      const input = control<HTMLInputElement>("#trust-evidence-digest");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "c".repeat(64),
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      submit("Record version-fenced decision");
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
  });

  it("sends a takedown only after fresh evidence and explicit confirmation for the loaded version", async () => {
    let submitted = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") submitted = true;
      const current = {
        ...trustCase,
        version: submitted ? 3 : 2,
        state: submitted ? "taken_down" : "accepted",
      };
      return Response.json(url.endsWith("/evidence") ? evidenceFor(current) : current);
    });
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    await select("#trust-action", "takedown");
    await enter("#trust-evidence-digest", "b".repeat(64));
    await act(async () => submit("Record version-fenced decision"));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await act(async () => control<HTMLInputElement>('input[type="checkbox"]').click());
    await act(async () => submit("Record version-fenced decision"));
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(`/api/trust/cases/${trustCase.id}/takedown`);
    expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual({
      expectedVersion: 2,
      reasonCode: "rights_or_policy_violation",
      evidenceDigestSha256: "b".repeat(64),
    });
    expect(control<HTMLInputElement>("#trust-action-version").value).toBe("3");
    expect(control<HTMLInputElement>("#trust-evidence-digest").value).toBe("");
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
  });

  it("rejects an unrecognized action instead of interpreting it as an appeal outcome", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(url.endsWith("/evidence") ? evidence : trustCase),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadCase();
    const action = control<HTMLSelectElement>("#trust-action");
    const option = document.createElement("option");
    option.value = "generated-unknown-action";
    action.append(option);
    action.value = option.value;
    await act(async () => submit("Record version-fenced decision"));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(container.textContent).toContain("Choose the current reviewer action before deciding.");
  });
});
