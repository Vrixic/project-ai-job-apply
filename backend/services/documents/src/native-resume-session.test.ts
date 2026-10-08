import { expect, it, vi } from "vitest";
import {
  createNativeResumeSession,
  type NativeResumeSessionOptions,
} from "./native-resume-session.js";

it("refuses default-off before any kernel or source capability", () => {
  const effect = vi.fn();
  expect(() =>
    createNativeResumeSession({
      kernel: { shortenBoot: effect },
    } as unknown as NativeResumeSessionOptions),
  ).toThrow();
  expect(effect).not.toHaveBeenCalled();
});
it("rejects accessor identities without evaluating candidate data", () => {
  const getter = vi.fn();
  const identity = Object.defineProperty({}, "ownerUserId", { enumerable: true, get: getter });
  expect(() =>
    createNativeResumeSession({
      enabled: () => true,
      identity,
    } as unknown as NativeResumeSessionOptions),
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
