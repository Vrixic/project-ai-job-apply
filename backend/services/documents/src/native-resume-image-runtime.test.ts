import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  startNativeResumeImage,
  validateNativeResumeImageConfiguration,
} from "./native-resume-image-runtime.js";

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
