import { createHash } from "node:crypto";
import { DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { expect, it, vi } from "vitest";
import type { NativeResumeGenerationRecord } from "./native-resume-generation-store.js";
import { createNativeResumeTaskObserver } from "./native-resume-task-observer.js";
import { nativeTaskLaunchConfiguration } from "./native-task-launch-policy.js";

const scope = {
  ownerUserId: "019d04cf-1f80-7000-8000-000000000101",
  applicationId: "019d04cf-1f80-7000-8000-000000000102",
  generationId: "019d04cf-1f80-7000-8000-000000000103",
  allocationId: "019d04cf-1f80-7000-8000-000000000104",
  epochId: "019d04cf-1f80-7000-8000-000000000105",
};
const configuration = nativeTaskLaunchConfiguration({
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/resume",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/resume:7",
  containerName: "native-resume",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/resume@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/task",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "ENABLED",
});
const sha = createHash("sha256")
  .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...configuration }))
  .digest("hex");
const allocation = {
  ...scope,
  clusterArn: configuration.clusterArn,
  taskDefinitionArn: configuration.taskDefinitionArn,
  containerName: configuration.containerName,
  taskArn: "arn:aws:ecs:us-east-2:123456789012:task/resume/12345678901234567890123456789012",
};
function setup(state: "bound" | "retired" = "bound") {
  // Registry-owned metadata only; unrelated original document/application fields are unused.
  const record = {
    state,
    allocation,
    allocationId: scope.allocationId,
    epochId: scope.epochId,
    configurationSha256: sha,
    reservation: { identity: scope, deployment: configuration },
  } as unknown as NativeResumeGenerationRecord;
  const readLaunch = vi.fn(async () => structuredClone(record));
  const recordRetirement = vi.fn(async () => undefined);
  const send = vi.fn(async (command: unknown): Promise<unknown> => {
    expect(command).toBeInstanceOf(DescribeTasksCommand);
    return {
      tasks: [
        {
          ...allocation,
          startedBy: scope.allocationId,
          lastStatus: "STOPPED",
          desiredStatus: "STOPPED",
          stoppedAt: new Date(Date.now() - 100),
          containers: [
            {
              name: configuration.containerName,
              taskArn: allocation.taskArn,
              lastStatus: "STOPPED",
            },
          ],
        },
      ],
    };
  });
  const enabled = vi.fn(() => true);
  const options = {
    configuration,
    registry: { readLaunch, recordRetirement },
    enabled,
    testClient: { send },
  };
  return {
    record,
    readLaunch,
    recordRetirement,
    send,
    enabled,
    options,
    observer: createNativeResumeTaskObserver(options),
  };
}
it("records only an actual exact DescribeTasks terminal receipt", async () => {
  const x = setup();
  await expect(x.observer.observe(scope)).resolves.toMatchObject({
    outcome: "retired",
    taskArn: allocation.taskArn,
  });
  expect(x.readLaunch).toHaveBeenCalledWith(scope, sha);
  expect(x.send).toHaveBeenCalledOnce();
  expect(x.recordRetirement).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "native_task_stopped",
      taskArn: allocation.taskArn,
      allocationId: scope.allocationId,
    }),
  );
});
it("replays stored retirement without depending on ECS retention", async () => {
  const x = setup("retired");
  await expect(x.observer.observe(scope)).resolves.toMatchObject({ outcome: "retired" });
  expect(x.send).not.toHaveBeenCalled();
  expect(x.recordRetirement).not.toHaveBeenCalled();
});
it.each(["running", "missing", "error"])(
  "leaves %s evidence unresolved and never requests StopTask",
  async (mode) => {
    const x = setup();
    x.send.mockImplementation(async (command) => {
      expect(command).toBeInstanceOf(DescribeTasksCommand);
      if (mode === "error") throw Error("synthetic diagnostic");
      return {
        tasks:
          mode === "missing"
            ? []
            : [
                {
                  ...allocation,
                  startedBy: scope.allocationId,
                  lastStatus: "RUNNING",
                  desiredStatus: "RUNNING",
                },
              ],
      };
    });
    await expect(x.observer.observe(scope)).rejects.toThrow(
      "NativeResumeTaskObservationUnavailable",
    );
    expect(x.recordRetirement).not.toHaveBeenCalled();
  },
);
it("refuses changed original configuration before ECS", async () => {
  const x = setup();
  x.record.configurationSha256 = "b".repeat(64);
  await expect(x.observer.observe(scope)).rejects.toThrow();
  expect(x.send).not.toHaveBeenCalled();
});
it("default-off refuses before registry access", async () => {
  const x = setup();
  const { enabled: _enabled, ...options } = x.options;
  await expect(createNativeResumeTaskObserver(options).observe(scope)).rejects.toThrow();
  expect(x.readLaunch).not.toHaveBeenCalled();
});
it("does not acknowledge a lost persistence ACK and can replay recorded retirement", async () => {
  const x = setup();
  x.recordRetirement.mockImplementationOnce(async () => {
    x.record.state = "retired";
    throw Error("lost ACK");
  });
  await expect(x.observer.observe(scope)).rejects.toThrow();
  await expect(x.observer.observe(scope)).resolves.toMatchObject({ outcome: "retired" });
  expect(x.send).toHaveBeenCalledOnce();
});
it("refuses withdrawal after observation before persistence", async () => {
  const x = setup();
  const send = x.send.getMockImplementation();
  x.send.mockImplementation(async (command) => {
    const result = await send?.(command);
    x.enabled.mockReturnValue(false);
    return result;
  });
  await expect(x.observer.observe(scope)).rejects.toThrow();
  expect(x.recordRetirement).not.toHaveBeenCalled();
});
