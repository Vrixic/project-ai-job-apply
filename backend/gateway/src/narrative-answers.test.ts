import {
  ModelGateway,
  type ModelProvider,
  OpenAiLunaProvider,
  ScriptedProvider,
  TemplateProvider,
} from "@ai-job-apply/ai-sdk";
import {
  ApplicationJobUnavailableError,
  NarrativeAnswerLimitError,
  NarrativeAnswersUnavailableError,
} from "@ai-job-apply/applications-service";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import {
  classifyNarrativeQuestion,
  createNarrativeAnswers,
  createProviderKeySource,
  memoryNarrativeLimiter,
  narrativeAnswersFromEnvironment,
} from "./narrative-answers.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const OWNER = "00000000-0000-7000-8000-000000000001";
const APPLICATION = "00000000-0000-7000-8000-000000000002";
const JOB = "00000000-0000-7000-8000-000000000003";
const QUESTION =
  "What interests you about this role at Prompt.io, and what would you bring to the team?";

function fact(id: string, overrides: Partial<GraphFact> = {}): GraphFact {
  return {
    id,
    kind: "skill",
    key: "skill",
    value: "TypeScript",
    verification: "confirmed",
    sensitivity: "standard",
    source: { type: "user", reference: "direct-entry" },
    version: 1,
    ...overrides,
  };
}

const job = {
  status: "active",
  title: "Software Engineer",
  company: { name: "Prompt.io" },
  description: "Build prompt tooling.",
  expiresAt: new Date(NOW.getTime() + 86_400_000),
};

function setup(
  provider: ModelProvider,
  options: { facts?: GraphFact[]; enabled?: boolean; limit?: number } = {},
) {
  const enabled = () => options.enabled ?? true;
  const listGroundingFacts = vi.fn(async () => options.facts ?? [fact("f1")]);
  const getActiveJob = vi.fn(async () => job);
  const answers = createNarrativeAnswers({
    // biome-ignore lint/suspicious/noExplicitAny: a minimal catalog double
    catalog: { getActiveJob } as any,
    profile: { listGroundingFacts },
    gateway: new ModelGateway(provider, { enabled, clock: () => NOW }),
    enabled,
    limiter: memoryNarrativeLimiter({ perMinute: options.limit ?? 6, perDay: 60 }),
    clock: () => NOW,
  });
  const generate = (question = QUESTION) =>
    answers.generate({
      ownerUserId: OWNER,
      applicationId: APPLICATION,
      canonicalJobId: JOB,
      request: { question },
    });
  return { generate, listGroundingFacts, getActiveJob };
}

describe("classifyNarrativeQuestion", () => {
  it("lets an ordinary open question through", () => {
    expect(classifyNarrativeQuestion(QUESTION)).toBe("ok");
    expect(classifyNarrativeQuestion("Why do you want to work in health tech?")).toBe("ok");
  });

  it.each([
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require visa sponsorship?",
    "What is your gender identity?",
    "Do you identify as a protected veteran?",
    "Do you have a disability? Please describe.",
    "I certify that the above is true",
    "Have you ever been convicted of a crime?",
  ])("declines the sensitive question %j", (question) => {
    expect(classifyNarrativeQuestion(question)).toBe("sensitive_question");
  });

  it.each([
    "What are your salary expectations?",
    "What is your notice period?",
    "Are you willing to relocate?",
  ])("leaves %j to the Profile", (question) => {
    expect(classifyNarrativeQuestion(question)).toBe("answered_from_profile");
  });
});

describe("narrative answers", () => {
  it("drafts a grounded answer from confirmed facts", async () => {
    const { generate } = setup(new TemplateProvider());
    const answer = await generate();
    expect(answer).toMatchObject({ status: "ready", promptVersion: "1.1.0" });
    expect(answer.status === "ready" && answer.text).toContain("TypeScript");
  });

  it("declines a sensitive question without calling the model or reading the Profile", async () => {
    const provider = new ScriptedProvider('{"paragraphs":[]}');
    const { generate, listGroundingFacts } = setup(provider);
    expect(await generate("Are you authorized to work in the United States?")).toEqual({
      status: "declined",
      reason: "sensitive_question",
    });
    expect(provider.calls).toHaveLength(0);
    expect(listGroundingFacts).not.toHaveBeenCalled();
  });

  it("never sends restricted or unconfirmed facts to the model", async () => {
    const provider = new ScriptedProvider(
      JSON.stringify({ paragraphs: [{ text: "I use TypeScript.", factIds: ["f1"] }] }),
    );
    const { generate } = setup(provider, {
      facts: [
        fact("f1"),
        fact("f-restricted", { value: "SecretRestrictedSkill", sensitivity: "restricted" }),
        fact("f-proposed", { value: "Rust", verification: "proposed" }),
      ],
    });
    await generate();
    const prompt = provider.calls.map((call) => `${call.system}\n${call.user}`).join("\n");
    expect(prompt).toContain("TypeScript");
    expect(prompt).not.toContain("SecretRestrictedSkill");
    expect(prompt).not.toContain("Rust");
  });

  it("puts the question last and gives the provider a shared cache key per application", async () => {
    const provider = new ScriptedProvider(
      JSON.stringify({ paragraphs: [{ text: "I use TypeScript.", factIds: ["f1"] }] }),
    );
    const { generate } = setup(provider);
    await generate();
    await generate("Describe a project you are proud of.");
    const [first, second] = provider.calls;
    expect(first?.cacheKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(first?.cacheKey).toBe(second?.cacheKey);
    expect(first?.cacheKey).not.toContain(OWNER);
    // Everything before the question is identical, so the provider can cache that prefix.
    const prefix = (user: string) => user.slice(0, user.indexOf("QUESTION"));
    expect(prefix(first?.user ?? "")).toBe(prefix(second?.user ?? ""));
    expect(first?.user.trimEnd().split("\n").at(-1)).toContain("What interests you");
  });

  it("says there is nothing to write from when the Profile has no confirmed facts", async () => {
    const provider = new ScriptedProvider('{"paragraphs":[]}');
    const { generate } = setup(provider, { facts: [] });
    expect(await generate()).toEqual({ status: "declined", reason: "no_profile_evidence" });
    expect(provider.calls).toHaveLength(0);
  });

  it("tries once more when a draft states something unsupported, then declines", async () => {
    const provider = new ScriptedProvider(
      JSON.stringify({
        paragraphs: [{ text: "I led a team of 40 engineers.", factIds: ["f1"] }],
      }),
    );
    const { generate } = setup(provider);
    expect(await generate()).toEqual({ status: "declined", reason: "not_grounded" });
    expect(provider.calls).toHaveLength(2);
  });

  it("is unavailable, with no model call, while the kill switch is off", async () => {
    const provider = new ScriptedProvider('{"paragraphs":[]}');
    const { generate } = setup(provider, { enabled: false });
    await expect(generate()).rejects.toBeInstanceOf(NarrativeAnswersUnavailableError);
    expect(provider.calls).toHaveLength(0);
  });

  it("is unavailable when the provider fails, without echoing anything from it", async () => {
    const failing: ModelProvider = {
      identity: { provider: "x", model: "y", version: "z" },
      complete: async () => {
        throw new Error("secret provider text");
      },
    };
    const { generate } = setup(failing);
    await expect(generate()).rejects.toBeInstanceOf(NarrativeAnswersUnavailableError);
  });

  it("refuses an inactive or expired job", async () => {
    const { generate, getActiveJob } = setup(new TemplateProvider());
    getActiveJob.mockResolvedValueOnce({ ...job, expiresAt: new Date(NOW.getTime() - 1) });
    await expect(generate()).rejects.toBeInstanceOf(ApplicationJobUnavailableError);
  });

  it("limits how fast one candidate can ask", async () => {
    const { generate } = setup(new TemplateProvider(), { limit: 2 });
    await generate();
    await generate();
    await expect(generate()).rejects.toBeInstanceOf(NarrativeAnswerLimitError);
  });
});

describe("memoryNarrativeLimiter", () => {
  it("counts per candidate over a minute and a day, then lets time pass", () => {
    let now = 0;
    const limiter = memoryNarrativeLimiter({ perMinute: 2, perDay: 3, clock: () => now });
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
    expect(limiter.take("b")).toBe(0);
    now += 61_000;
    expect(limiter.take("a")).toBe(0);
    now += 61_000;
    expect(limiter.take("a")).toBeGreaterThan(0);
    now += 24 * 60 * 60_000;
    expect(limiter.take("a")).toBe(0);
  });

  it("bounds how many candidates it remembers", () => {
    const limiter = memoryNarrativeLimiter({ perMinute: 1, perDay: 1, maximumCandidates: 2 });
    limiter.take("a");
    limiter.take("b");
    limiter.take("c");
    // "a" was forgotten, so it may ask again; "c" is still limited.
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("c")).toBeGreaterThan(0);
  });
});

describe("createProviderKeySource", () => {
  const ARN = "arn:aws:secretsmanager:us-east-2:123456789012:secret:openai-key-AbCdEf";
  const secret = (value: unknown, ok = true) =>
    vi.fn(
      async () => new Response(JSON.stringify({ SecretString: value }), { status: ok ? 200 : 500 }),
    );

  it("reads the key through the Lambda extension and caches it", async () => {
    const fetchImplementation = secret("sk-test-0123456789abcdef");
    const keys = createProviderKeySource({
      secretId: ARN,
      sessionToken: "token",
      fetchImplementation,
    });
    expect(keys.current()).toBeUndefined();
    await keys.ensure();
    await keys.ensure();
    expect(keys.current()).toBe("sk-test-0123456789abcdef");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("http://localhost:2773/secretsmanager/get");
    expect((init.headers as Record<string, string>)["X-Aws-Parameters-Secrets-Token"]).toBe(
      "token",
    );
  });

  it("fails closed on a missing, malformed or unreachable key", async () => {
    await expect(
      createProviderKeySource({
        secretId: ARN,
        sessionToken: "t",
        fetchImplementation: secret("short"),
      }).ensure(),
    ).rejects.toThrow();
    await expect(
      createProviderKeySource({
        secretId: ARN,
        sessionToken: "t",
        fetchImplementation: secret("x", false),
      }).ensure(),
    ).rejects.toThrow();
    expect(createProviderKeySource({ secretId: "not-an-arn", sessionToken: "t" }).configured).toBe(
      false,
    );
  });

  it("keeps serving a recent key through a brief outage", async () => {
    let now = 0;
    const fetchImplementation = secret("sk-test-0123456789abcdef");
    const keys = createProviderKeySource({
      secretId: ARN,
      sessionToken: "t",
      fetchImplementation,
      clock: () => now,
    });
    await keys.ensure();
    now += 11 * 60_000;
    fetchImplementation.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(keys.ensure()).resolves.toBeUndefined();
    expect(keys.current()).toBe("sk-test-0123456789abcdef");
    now += 2 * 60 * 60_000;
    fetchImplementation.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(keys.ensure()).rejects.toThrow();
  });
});

describe("narrativeAnswersFromEnvironment", () => {
  const dependencies = {
    // biome-ignore lint/suspicious/noExplicitAny: minimal doubles
    catalog: { getActiveJob: async () => null } as any,
    profile: { listGroundingFacts: async () => [] },
  };

  it("is dark unless the kill switch is on and a key is configured", () => {
    expect(narrativeAnswersFromEnvironment({}, dependencies)).toBeUndefined();
    expect(
      narrativeAnswersFromEnvironment({ OPENAI_API_KEY: "sk-test-0123456789abcdef" }, dependencies),
    ).toBeUndefined();
    expect(
      narrativeAnswersFromEnvironment({ NARRATIVE_ANSWERS_ENABLED: "true" }, dependencies),
    ).toBeUndefined();
    expect(
      narrativeAnswersFromEnvironment(
        { NARRATIVE_ANSWERS_ENABLED: "true", OPENAI_API_KEY: "sk-test-0123456789abcdef" },
        dependencies,
      ),
    ).toBeDefined();
  });

  it("uses the one provider the owner approved", () => {
    expect(new OpenAiLunaProvider({ apiKey: () => undefined }).identity.model).toBe("gpt-6-luna");
  });
});
