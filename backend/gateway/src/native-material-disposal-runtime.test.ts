import { describe, expect, it } from "vitest";
import {
  nativeMaterialDisposalFromEnvironment,
  parseNativeDisposalDeployments,
} from "./native-material-disposal-runtime.js";

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
    await expect(runtime.ownerCleanup.step("owner", "request")).rejects.toThrow(
      "NativeOwnerMaterialCleanupUnavailable",
    );
    environment.NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS = "[]";
    await expect(runtime.discardApplication("owner", "application")).rejects.toThrow(
      "NativeMaterialDisposalUnavailable",
    );
  } finally {
    await runtime.close();
  }
});

const CLUSTER = "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials";
const task = (revision: number) =>
  `arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:${revision}`;

describe("retained deployments serialization", () => {
  const expected = [
    { clusterArn: CLUSTER, taskDefinitionArn: task(4), containerName: "resume" },
    { clusterArn: CLUSTER, taskDefinitionArn: task(5), containerName: "materials" },
  ];

  it("reads the list form and the compact form into the same deployments", () => {
    expect(parseNativeDisposalDeployments(JSON.stringify(expected))).toEqual(expected);
    const compact = JSON.stringify({
      c: CLUSTER,
      d: [
        [task(4), "resume"],
        [task(5), "materials"],
      ],
    });
    expect(parseNativeDisposalDeployments(compact)).toEqual(expected);
  });

  it("names the cluster once, so retaining revisions grows the environment by less", () => {
    const many = Array.from({ length: 4 }, (_, index) => ({
      clusterArn: CLUSTER,
      taskDefinitionArn: task(index + 1),
      containerName: "materials",
    }));
    const list = JSON.stringify(many);
    const compact = JSON.stringify({
      c: CLUSTER,
      d: many.map((entry) => [entry.taskDefinitionArn, entry.containerName]),
    });
    expect(compact.length).toBeLessThan(list.length - 200);
  });

  it.each([
    ["no deployments", JSON.stringify({ c: CLUSTER, d: [] })],
    ["nine deployments", JSON.stringify({ c: CLUSTER, d: Array(9).fill([task(1), "m"]) })],
    ["an extra key", JSON.stringify({ c: CLUSTER, d: [[task(1), "m"]], x: 1 })],
    ["a missing cluster", JSON.stringify({ d: [[task(1), "m"]] })],
    ["a non-string cluster", JSON.stringify({ c: 7, d: [[task(1), "m"]] })],
    ["a three-part entry", JSON.stringify({ c: CLUSTER, d: [[task(1), "m", "x"]] })],
    ["a non-string entry", JSON.stringify({ c: CLUSTER, d: [[task(1), 5]] })],
    ["an object entry", JSON.stringify({ c: CLUSTER, d: [{ taskDefinitionArn: task(1) }] })],
    [
      "a foreign region",
      JSON.stringify({
        c: "arn:aws:ecs:eu-west-1:123456789012:cluster/x",
        d: [["arn:aws:ecs:eu-west-1:123456789012:task-definition/x:1", "m"]],
      }),
    ],
    ["a list entry without a field", JSON.stringify([{ clusterArn: CLUSTER, containerName: "m" }])],
    ["nine list entries", JSON.stringify(Array(9).fill(expected[0]))],
  ])("rejects %s", (_name, serialized) => {
    expect(() => parseNativeDisposalDeployments(serialized)).toThrow(
      "NativeApplicationDisposalConfigurationInvalid",
    );
  });
});
