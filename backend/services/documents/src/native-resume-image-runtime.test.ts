import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  composeNativeLiveTailor,
  startNativeResumeImage,
  validateNativeResumeImageConfiguration,
} from "./native-resume-image-runtime.js";
import { buildResumeAst } from "./resume-ast/build.js";
import { syntheticDocument } from "./resume-ast/test-support.js";
import { LIVE_TAILORING_OUTPUT, renderLiveTailoringPrompt } from "./tailoring/live-tailor.js";

const configuration = () =>
  JSON.parse(
    readFileSync(
      new URL("../../../workers/ai/native-resume/configuration.disabled.json", import.meta.url),
      "utf8",
    ),
  );
it("accepts the closed default-off image configuration and refuses startup before effects", async () => {
  const config = configuration();
  expect(validateNativeResumeImageConfiguration(config)).toBe(true);
  const effect = vi.fn();
  await expect(
    startNativeResumeImage({
      configuration: config,
      loadKernel: effect,
      testMetadataFetch: effect,
      testSecretClient: { send: effect },
    }),
  ).rejects.toThrow("NativeResumeImageConfigurationUnavailable");
  expect(effect).not.toHaveBeenCalled();
});
it.each([
  { providerEnabled: true },
  { providerSecret: {} },
  { enabled: "true" },
  { port: 443 },
  { apiOrigin: "http://api.synthetic.invalid" },
  { origin: "https://app.synthetic.invalid/path" },
  { baseHost: "*.synthetic.invalid" },
  { audience: "" },
  { sourceFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:source:latest" },
  { sourceFunctionArn: "arn:aws:lambda:us-east-2:999999999999:function:source:1" },
])("refuses unsafe or provider-bearing configuration %j", (change) => {
  expect(validateNativeResumeImageConfiguration({ ...configuration(), ...change })).toBe(false);
});
it("requires distinct numeric control/source targets and a pinned TLS secret", () => {
  const config = configuration();
  expect(
    validateNativeResumeImageConfiguration({
      ...config,
      sourceFunctionArn: config.ownerFunctionArn,
    }),
  ).toBe(false);
  expect(
    validateNativeResumeImageConfiguration({
      ...config,
      tlsSecret: { ...config.tlsSecret, versionId: "AWSCURRENT" },
    }),
  ).toBe(false);
});

const live = { modelId: "us.anthropic.claude-sonnet-4-6" };
it("keeps every released configuration valid and accepts only the reviewed shape of live generation", () => {
  for (const name of ["configuration.r3.json", "configuration.r4.json"])
    expect(
      validateNativeResumeImageConfiguration(
        JSON.parse(
          readFileSync(
            new URL(`../../../workers/ai/native-resume/${name}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
      name,
    ).toBe(true);
  expect(validateNativeResumeImageConfiguration({ ...configuration(), liveGeneration: live })).toBe(
    true,
  );
  for (const bad of [
    null,
    "us.anthropic.claude-sonnet-4-6",
    {},
    { modelId: "anthropic.claude-sonnet-4-6" },
    { modelId: "gpt-6-luna" },
    {
      modelId:
        "arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6",
    },
    { modelId: "us.anthropic.claude-sonnet-4-6/../x" },
    { ...live, region: "us-east-2" },
    { ...live, enabled: true },
  ])
    expect(
      validateNativeResumeImageConfiguration({ ...configuration(), liveGeneration: bad }),
      JSON.stringify(bad),
    ).toBe(false);
});
it("composes the live tailor on the task role path and stays inert while disabled", async () => {
  const lines = [
    "Alex Example",
    "Experience",
    "Senior Engineer - Acme Corp",
    "2021 - Present",
    "• Built a payments API in TypeScript serving 40 partners",
    "• Reduced deploy time from 30 to 6 minutes",
    "• Mentored four junior engineers",
    "• Ran the on call rotation for the billing team",
  ];
  const ast = buildResumeAst(syntheticDocument(lines));
  const job = { title: "Backend Engineer", description: "Payments APIs in TypeScript" };
  const entry = renderLiveTailoringPrompt(ast, job)?.entries[0];
  if (!entry) throw new Error("fixture");
  const wanted = [entry.bulletIds[1], entry.bulletIds[0], entry.bulletIds[3]];
  const send = vi.fn(async (_command: ConverseCommand, _options: { abortSignal: AbortSignal }) => ({
    $metadata: {},
    stopReason: "tool_use" as const,
    output: {
      message: {
        role: "assistant" as const,
        content: [
          {
            toolUse: {
              toolUseId: "t",
              name: LIVE_TAILORING_OUTPUT.name,
              input: { entries: [{ entryId: entry.entryId, bulletIds: wanted }] },
            },
          },
        ],
      },
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metrics: { latencyMs: 1 },
  }));
  let on = true;
  const composed = composeNativeLiveTailor({
    ...live,
    accountId: "123456789012",
    enabled: () => on,
    testBedrockClient: { send: send as never },
  });
  const tailored = await composed.liveTailor(ast, job);
  expect(tailored?.tailoringVersion).toBe("tailoring.live.v1");
  expect(
    tailored?.sections.find((section) => section.kind === "experience")?.entries[0]?.bulletNodeIds,
  ).toEqual(wanted);
  const sent = send.mock.calls[0]?.[0].input;
  expect(sent?.modelId).toBe(live.modelId);
  expect(sent?.inferenceConfig).toEqual({ maxTokens: 2_048, temperature: 0 });
  expect(JSON.stringify(sent)).not.toContain("Alex Example");
  on = false;
  await expect(composed.liveTailor(ast, job)).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledTimes(1);
  composed.destroy();
});
