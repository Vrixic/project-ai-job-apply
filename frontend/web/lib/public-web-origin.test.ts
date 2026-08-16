import { describe, expect, it } from "vitest";
import { loadPublicWebSettings } from "./public-web-origin.js";

describe("public web settings", () => {
  it("defaults crawlability off and permits loopback development", () => {
    expect(loadPublicWebSettings({ APP_BASE_URL: "http://localhost:3000" })).toMatchObject({
      indexingEnabled: false,
    });
    expect(loadPublicWebSettings({ APP_BASE_URL: "http://[::1]:3000" })).toMatchObject({
      indexingEnabled: false,
    });
  });

  it.each([
    "https://user:secret@jobs.example.com",
    "https://jobs.example.com/path",
    "https://jobs.example.com?host=evil.test",
    "http://jobs.example.com",
    "https://localhost.",
    "https://example.com.",
    "https://jobs.example.com.",
  ])("rejects an unsafe canonical origin: %s", (APP_BASE_URL) => {
    expect(() => loadPublicWebSettings({ APP_BASE_URL })).toThrow();
  });

  it.each([
    "https://test",
    "https://jobs.test",
    "https://example",
    "https://jobs.example",
    "https://invalid",
    "https://jobs.invalid",
    "https://localhost",
    "https://jobs.localhost",
    "https://local",
    "https://jobs.local",
    "https://example.com",
    "https://jobs.example.com",
    "https://example.net",
    "https://jobs.example.org",
    "https://jobs",
    "https://192.0.2.10",
    "https://[2001:db8::10]",
    "https://[::1]",
  ])("fails closed when indexing uses a reserved or local origin: %s", (APP_BASE_URL) => {
    expect(() =>
      loadPublicWebSettings({ APP_BASE_URL, PUBLIC_JOB_INDEXING_ENABLED: "true" }),
    ).toThrow();
  });

  it("rejects non-exact indexing booleans", () => {
    expect(() =>
      loadPublicWebSettings({
        APP_BASE_URL: "https://jobs.acme-careers.com",
        PUBLIC_JOB_INDEXING_ENABLED: "TRUE",
      }),
    ).toThrow();
  });
});
