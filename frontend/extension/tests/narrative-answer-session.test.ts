import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NARRATIVE_ANSWER_REQUEST,
  parseNarrativeAnswerRequest,
} from "../lib/narrative-answer-protocol";
import { ANSWER_SESSION_MS, createNarrativeAnswerSession } from "../lib/narrative-answer-session";

const API = "https://api.example.test";
const APPLICATION = "00000000-0000-7000-8000-000000000001";
const PAGE = {
  tabId: 7,
  documentId: "A".repeat(32),
  applicationId: APPLICATION,
  employerUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
};
const REQUEST = {
  schema: NARRATIVE_ANSWER_REQUEST,
  question: "What interests you about this role?",
};
const sender = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "extension-id",
    url: "https://job-boards.greenhouse.io/acme/jobs/1#apply",
    tab: { id: 7, incognito: false },
    frameId: 0,
    documentId: PAGE.documentId,
    documentLifecycle: "active",
    ...overrides,
  }) as unknown as chrome.runtime.MessageSender;
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let clock = 0;
const identity = vi.fn(async () => ({
  accessToken: "synthetic-token",
  identityFence: "f".repeat(43),
}));
const inject = vi.fn(async () => undefined);
const fetchImplementation = vi.fn<typeof fetch>();

function session() {
  return createNarrativeAnswerSession({
    apiOrigin: API,
    identity,
    inject,
    now: () => clock,
    fetchImplementation,
  });
}

beforeEach(() => {
  clock = 1_000;
  vi.stubGlobal("chrome", { runtime: { id: "extension-id" } });
  fetchImplementation.mockReset();
  identity.mockClear();
  inject.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("narrative answer session", () => {
  it("answers only the page that was prepared, with the candidate's own session", async () => {
    fetchImplementation.mockResolvedValueOnce(
      reply({ status: "ready", text: "I build reliable services.", promptVersion: "1.1.0" }),
    );
    const answers = session();
    await answers.arm(PAGE);
    expect(inject).toHaveBeenCalledWith({ tabId: 7, documentId: PAGE.documentId });
    const result = await answers.handle(REQUEST, sender());
    expect(result).toEqual({ status: "ready", text: "I build reliable services." });
    const [url, init] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`${API}/v1/applications/${APPLICATION}/narrative-answers`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-token");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({ question: REQUEST.question });
  });

  it("leaves every other message to its own listener", () => {
    expect(session().handle({ schema: "something-else.v1" }, sender())).toBeUndefined();
    expect(session().handle("hello", sender())).toBeUndefined();
  });

  it.each([
    ["another tab", { tab: { id: 8, incognito: false } }],
    ["an incognito tab", { tab: { id: 7, incognito: true } }],
    ["a frame", { frameId: 3 }],
    ["another document", { documentId: "B".repeat(32) }],
    ["a page that is going away", { documentLifecycle: "prerender" }],
    ["another site", { url: "https://evil.example.test/acme/jobs/1" }],
    ["another extension", { id: "other" }],
  ])("refuses a request from %s without calling the API", async (_name, change) => {
    const answers = session();
    await answers.arm(PAGE);
    expect(await answers.handle(REQUEST, sender(change))).toEqual({
      status: "error",
      reason: "closed",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(identity).not.toHaveBeenCalled();
  });

  it("does nothing before a page is prepared, after it is cleared, or once it expires", async () => {
    const answers = session();
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "closed" });
    await answers.arm(PAGE);
    answers.clear(99);
    fetchImplementation.mockResolvedValue(reply({ status: "declined", reason: "not_grounded" }));
    expect(await answers.handle(REQUEST, sender())).toMatchObject({ status: "declined" });
    clock += ANSWER_SESSION_MS;
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "closed" });
    await answers.arm(PAGE);
    answers.clear(7);
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "closed" });
  });

  it("refuses a page that is not https, an unknown application and a failed injection", async () => {
    const http = session();
    await http.arm({ ...PAGE, employerUrl: "http://job-boards.greenhouse.io/x" });
    expect(inject).not.toHaveBeenCalled();
    await http.arm({ ...PAGE, applicationId: "../../x" });
    expect(inject).not.toHaveBeenCalled();
    inject.mockRejectedValueOnce(new Error("no access"));
    const failed = session();
    await failed.arm(PAGE);
    expect(await failed.handle(REQUEST, sender())).toEqual({ status: "error", reason: "closed" });
  });

  it("allows one draft at a time", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchImplementation.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const answers = session();
    await answers.arm(PAGE);
    const first = answers.handle(REQUEST, sender());
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "limit" });
    release(reply({ status: "ready", text: "Done.", promptVersion: "1.1.0" }));
    expect(await first).toEqual({ status: "ready", text: "Done." });
  });

  it.each([
    [429, "limit"],
    [503, "unavailable"],
    [401, "signin"],
    [403, "signin"],
    [500, "failed"],
  ] as const)("maps an API %i to %s without exposing anything else", async (status, reason) => {
    fetchImplementation.mockResolvedValueOnce(reply({ detail: "private" }, status));
    const answers = session();
    await answers.arm(PAGE);
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason });
  });

  it("says to sign in when there is no extension session, and rejects an unexpected reply", async () => {
    identity.mockRejectedValueOnce(new Error("signed out"));
    const answers = session();
    await answers.arm(PAGE);
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "signin" });
    fetchImplementation.mockResolvedValueOnce(reply({ status: "ready", text: "x", extra: 1 }));
    expect(await answers.handle(REQUEST, sender())).toEqual({ status: "error", reason: "failed" });
  });

  it("drops a draft that finishes after the page was cleared", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchImplementation.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const answers = session();
    await answers.arm(PAGE);
    const pending = answers.handle(REQUEST, sender());
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
    answers.clear();
    release(reply({ status: "ready", text: "late", promptVersion: "1.1.0" }));
    expect(await pending).toEqual({ status: "error", reason: "closed" });
  });
});

describe("parseNarrativeAnswerRequest", () => {
  it.each([
    ["too short", { ...REQUEST, question: "ab" }],
    ["too long", { ...REQUEST, question: "q".repeat(1001) }],
    ["a long hint", { ...REQUEST, guidance: "g".repeat(1001) }],
    ["an extra field", { ...REQUEST, applicationId: APPLICATION }],
    ["no schema", { question: "What interests you?" }],
    ["an array", []],
  ])("refuses %s", (_name, value) => {
    expect(parseNarrativeAnswerRequest(value)).toBeUndefined();
  });

  it("keeps only the question and the hint", () => {
    expect(parseNarrativeAnswerRequest({ ...REQUEST, guidance: "One paragraph." })).toEqual({
      ...REQUEST,
      guidance: "One paragraph.",
    });
  });
});
