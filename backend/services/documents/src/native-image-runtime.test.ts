import { describe, expect, it, vi } from "vitest";
import {
  type NativeImageConfiguration,
  startNativeImage,
  validateNativeImageConfiguration,
} from "./native-image-runtime.js";

function configuration(): NativeImageConfiguration {
  const secret = (name: string) => ({
    arn: `arn:aws:secretsmanager:us-east-2:123456789012:secret:native/${name}-Abc123`,
    versionId: "12345678-1234-1234-1234-123456789012",
  });
  return {
    schemaVersion: 1,
    enabled: false,
    providerEnabled: false,
    deployment: {
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
    ownerFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-owner:7",
    liveGeneration: { modelId: "us.anthropic.claude-sonnet-4-6" },
    tlsSecret: secret("tls"),
    apiOrigin: "https://api.synthetic.invalid",
    issuer: "https://issuer.synthetic.invalid/",
    audience: "ai-job-apply-api",
    origin: "https://app.synthetic.invalid",
    baseHost: "material.synthetic.invalid",
    port: 8443,
  };
}
describe("native image reviewed configuration", () => {
  it("accepts a closed scalar default-off configuration", () => {
    expect(validateNativeImageConfiguration(configuration())).toBe(true);
  });
  it.each([
    { port: 443 },
    { enabled: "true" },
    { providerEnabled: 1 },
    { apiOrigin: "http://api.synthetic.invalid" },
    { apiOrigin: "https://api.synthetic.invalid/path" },
    { origin: "https://app.synthetic.invalid/" },
    { issuer: "https://issuer.synthetic.invalid" },
    { baseHost: "*.synthetic.invalid" },
    { baseHost: "material.synthetic.invalid:8443" },
    { audience: "" },
    { ownerFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-owner:development" },
    { ownerFunctionArn: "arn:aws:lambda:us-east-2:999999999999:function:native-owner:7" },
    { subject: "candidate-not-an-image-parameter" },
    { apiKey: "never-in-configuration" },
    // The disclosure names the model, so the image cannot name any other (ADR-059 addendum 12).
    { liveGeneration: { modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0" } },
    { liveGeneration: { modelId: "gpt-6-luna" } },
    { liveGeneration: { modelId: "us.anthropic.claude-sonnet-4-6", maxTokens: 9999 } },
    { liveGeneration: {} },
    { liveGeneration: undefined },
    {
      providerSecret: {
        arn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:native/provider-Abc123",
        versionId: "12345678-1234-1234-1234-123456789012",
      },
    },
  ])("refuses unsafe image configuration %j", (change) => {
    expect(validateNativeImageConfiguration({ ...configuration(), ...change })).toBe(false);
  });
  it("refuses foreign, unpinned or additive secret configuration", () => {
    const config = configuration();
    for (const secret of [
      { ...config.tlsSecret, versionId: "AWSCURRENT" },
      { ...config.tlsSecret, arn: config.tlsSecret.arn.replace("us-east-2", "us-east-1") },
      { ...config.tlsSecret, secretValue: "never-in-configuration" },
    ]) {
      expect(validateNativeImageConfiguration({ ...config, tlsSecret: secret })).toBe(false);
    }
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    "refuses default-off startup before metadata, secret, provider or kernel effects %s/%s",
    async (enabled, providerEnabled) => {
      const effect = vi.fn(() => {
        throw Error("UnexpectedNativeImageEffect");
      });
      await expect(
        startNativeImage({
          configuration: { ...configuration(), enabled, providerEnabled },
          loadKernel: effect,
          testMetadataFetch: effect,
          testBedrockClient: { send: effect },
          testSecretClient: { send: effect },
        }),
      ).rejects.toThrow(/^NativeImageConfigurationUnavailable$/u);
      expect(effect).not.toHaveBeenCalled();
    },
  );
});
