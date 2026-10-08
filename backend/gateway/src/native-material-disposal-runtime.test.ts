import { expect, it } from "vitest";
import { nativeMaterialDisposalFromEnvironment } from "./native-material-disposal-runtime.js";

it("leaves terminal application behavior untouched when disabled", () => {
  expect(nativeMaterialDisposalFromEnvironment("invalid", {})).toBeUndefined();
});

it.each([undefined, "invalid", "[]", "{}", '[{"clusterArn":"foreign"}]'])(
  "rejects invalid enabled configuration before opening SQL: %s",
  (configuration) => {
    expect(() =>
      nativeMaterialDisposalFromEnvironment("invalid", {
        NATIVE_APPLICATION_DISPOSAL_ENABLED: "true",
        NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS: configuration,
      }),
    ).toThrow("NativeApplicationDisposalConfigurationInvalid");
  },
);

it("withdraws cleanup authority when pinned configuration changes", async () => {
  const environment = {
    NATIVE_APPLICATION_DISPOSAL_ENABLED: "true",
    NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS: JSON.stringify([
      {
        clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
        taskDefinitionArn:
          "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
        containerName: "materials",
      },
    ]),
  };
  const runtime = nativeMaterialDisposalFromEnvironment(
    "postgres://synthetic:synthetic@127.0.0.1:1/synthetic",
    environment,
  );
  if (!runtime) throw Error("Expected enabled disposal runtime");
  try {
    environment.NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS = "[]";
    await expect(runtime.discardApplication("owner", "application")).rejects.toThrow(
      "NativeMaterialDisposalUnavailable",
    );
  } finally {
    await runtime.close();
  }
});
