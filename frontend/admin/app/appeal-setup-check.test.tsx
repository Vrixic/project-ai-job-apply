// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppealSetupCheck } from "./appeal-setup-check";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("./appeal-setup-action", () => ({ verifyReviewerSetup: verify }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(AppealSetupCheck)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("explicit local reviewer setup interaction", () => {
  it("does nothing until clicked and sends no identity or credential as an argument", async () => {
    expect(verify).not.toHaveBeenCalled();
    verify.mockResolvedValue({ status: "verified" });
    await act(async () => container.querySelector("button")?.click());
    expect(verify).toHaveBeenCalledExactlyOnceWith();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "No reviewer roles were changed",
    );
    expect(container.textContent).not.toContain("Load review queue");
  });
  it.each(["unavailable", "sign_in_required", "verification_failed", "already_complete"])(
    "shows fixed accessible %s guidance",
    async (status) => {
      verify.mockResolvedValue({ status });
      await act(async () => container.querySelector("button")?.click());
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBeTruthy();
      expect(container.querySelector("button")?.disabled).toBe(false);
      expect(container.textContent).not.toContain("Reviewer setup checked.");
    },
  );
  it("never renders raw server or provider errors", async () => {
    verify.mockRejectedValue(new Error("private-subject-token-error"));
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("Reviewer setup could not be verified.");
    expect(container.textContent).not.toContain("private-subject-token-error");
  });
  it("disables repeat clicks while the request is pending", async () => {
    let finish: ((value: { status: "verified" }) => void) | undefined;
    verify.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => {
      finish?.({ status: "verified" });
    });
    expect(container.querySelector("button")?.disabled).toBe(false);
  });
});
