import { afterEach, describe, expect, it } from "vitest";
import {
  cachedUploadedResume,
  dropUploadedResume,
  holdUploadedResume,
  uploadedResumeKey,
} from "./uploaded-resume-cache";

afterEach(() => dropUploadedResume());

const KEY = uploadedResumeKey("app-1", "a".repeat(64));

describe("uploaded resume cache", () => {
  it("returns the held bytes only for the application and packet they were held under", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    holdUploadedResume(KEY, bytes);
    expect(cachedUploadedResume(KEY)).toBe(bytes);
    expect(cachedUploadedResume(uploadedResumeKey("app-1", "b".repeat(64)))).toBeUndefined();
    expect(cachedUploadedResume(uploadedResumeKey("app-2", "a".repeat(64)))).toBeUndefined();
  });

  it("holds one file: a new one replaces the old and the old bytes are zeroed", () => {
    const first = Uint8Array.from([1, 2, 3]);
    const otherKey = uploadedResumeKey("app-2", "b".repeat(64));
    holdUploadedResume(KEY, first);
    holdUploadedResume(otherKey, Uint8Array.from([4, 5, 6]));
    expect(Array.from(first)).toEqual([0, 0, 0]);
    expect(cachedUploadedResume(KEY)).toBeUndefined();
    expect(cachedUploadedResume(otherKey)).toBeDefined();
  });

  it("does not zero bytes it is asked to hold again", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    holdUploadedResume(KEY, bytes);
    holdUploadedResume(KEY, bytes);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("zeroes and forgets everything when dropped", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    holdUploadedResume(KEY, bytes);
    dropUploadedResume();
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    expect(cachedUploadedResume(KEY)).toBeUndefined();
  });
});
