// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealControl } from "../lib/reveal";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("revealControl", () => {
  it("scrolls the control to the middle of the window and waits", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="a">';
    const input = document.querySelector("#a") as HTMLInputElement;
    const scroll = vi.fn();
    input.scrollIntoView = scroll;
    let done = false;
    const pending = revealControl(input, 450, new Promise(() => undefined)).then(() => {
      done = true;
    });
    expect(scroll).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "smooth" });
    await vi.advanceTimersByTimeAsync(449);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(done).toBe(true);
  });
  it("does nothing when no pause is requested", async () => {
    document.body.innerHTML = '<input id="a">';
    const input = document.querySelector("#a") as HTMLInputElement;
    const scroll = vi.fn();
    input.scrollIntoView = scroll;
    await revealControl(input, 0, new Promise(() => undefined));
    expect(scroll).not.toHaveBeenCalled();
  });
  it("stops waiting when the run is stopped", async () => {
    document.body.innerHTML = '<input id="a">';
    const input = document.querySelector("#a") as HTMLInputElement;
    input.scrollIntoView = vi.fn();
    await expect(
      revealControl(input, 60_000, Promise.reject(new Error("stopped"))),
    ).rejects.toThrow("stopped");
  });
});
