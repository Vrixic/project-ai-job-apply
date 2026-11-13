import type { DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeTaskAbsenceObserver } from "./native-task-absence.js";

const cluster = "arn:aws:ecs:us-east-2:362544434697:cluster/ai-job-apply-development";
const other = "arn:aws:ecs:us-east-2:362544434697:cluster/another";
const task = (id: string, name = "ai-job-apply-development") =>
  `arn:aws:ecs:us-east-2:362544434697:task/${name}/${id}`;
const a = task("a1b2c3d4e5f60718293a4b5c6d7e8f90");
const b = task("b1b2c3d4e5f60718293a4b5c6d7e8f90");
const c = task("c1b2c3d4e5f60718293a4b5c6d7e8f90");

function observer(
  respond: (input: { cluster?: string; tasks?: string[] }) => unknown,
  clusterArns: string[] = [cluster],
) {
  const send = vi.fn(async (command: DescribeTasksCommand) => {
    const result = respond(command.input as { cluster?: string; tasks?: string[] });
    if (result instanceof Error) throw result;
    return result;
  });
  return { send, observer: createNativeTaskAbsenceObserver({ clusterArns, testClient: { send } }) };
}

afterEach(() => vi.restoreAllMocks());

describe("native task absence observer (migration 0021)", () => {
  it("counts a task as gone only when ECS reports it missing or stopped", async () => {
    const { observer: seen, send } = observer(() => ({
      tasks: [
        { taskArn: b, clusterArn: cluster, lastStatus: "STOPPED" },
        { taskArn: c, clusterArn: cluster, lastStatus: "RUNNING" },
      ],
      failures: [{ arn: a, reason: "MISSING" }],
    }));
    const gone = await seen.absent([a, b, c]);
    expect([...gone].sort()).toEqual([a, b].sort());
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toEqual({ cluster, tasks: [a, b, c] });
  });

  it.each([
    "PROVISIONING",
    "PENDING",
    "ACTIVATING",
    "RUNNING",
    "DEACTIVATING",
    "STOPPING",
    "DEPROVISIONING",
  ])("never counts a %s task as gone", async (lastStatus) => {
    const { observer: seen } = observer(() => ({
      tasks: [{ taskArn: a, clusterArn: cluster, lastStatus }],
      failures: [],
    }));
    expect((await seen.absent([a])).size).toBe(0);
  });

  it("does not trust a failure other than MISSING, a task of another cluster, or contradictory evidence", async () => {
    const { observer: seen } = observer(() => ({
      tasks: [
        { taskArn: b, clusterArn: other, lastStatus: "STOPPED" },
        { taskArn: c, clusterArn: cluster, lastStatus: "STOPPED" },
      ],
      failures: [
        { arn: a, reason: "ACCESS_DENIED" },
        { arn: c, reason: "MISSING" },
      ],
    }));
    expect((await seen.absent([a, b, c])).size).toBe(0);
  });

  it("never asks about a task outside the retained clusters or one that is not a task ARN", async () => {
    const { observer: seen, send } = observer(() => ({ tasks: [], failures: [] }));
    const gone = await seen.absent([
      task("d1b2c3d4e5f60718293a4b5c6d7e8f90", "elsewhere"),
      "not an arn",
      `${a}/extra`,
      "arn:aws:ecs:us-east-1:362544434697:task/ai-job-apply-development/abc",
    ]);
    expect(gone.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("describes each retained cluster on its own", async () => {
    const { observer: seen, send } = observer(
      ({ tasks }) => ({
        tasks: [],
        failures: (tasks ?? []).map((arn) => ({ arn, reason: "MISSING" })),
      }),
      [cluster, other],
    );
    const elsewhere = task("f1b2c3d4e5f60718293a4b5c6d7e8f90", "another");
    const gone = await seen.absent([a, elsewhere, b]);
    expect([...gone].sort()).toEqual([a, b, elsewhere].sort());
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { cluster, tasks: [a, b] },
      { cluster: other, tasks: [elsewhere] },
    ]);
  });

  it("considers at most 100 tasks in one call", async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      task(`e${String(index).padStart(3, "0")}b2c3d4e5f60718293a4b5c6d7e8f90`),
    );
    const { observer: seen, send } = observer(({ tasks }) => ({
      tasks: [],
      failures: (tasks ?? []).map((arn) => ({ arn, reason: "MISSING" })),
    }));
    expect((await seen.absent(many)).size).toBe(100);
    expect(send).toHaveBeenCalledOnce();
  });

  it("treats an error as unproven and logs only fixed fields", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = Object.assign(new Error(`Access denied to ${a}`), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 400 },
    });
    const { observer: seen } = observer(() => failure);
    expect((await seen.absent([a])).size).toBe(0);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("native_task_absence_unavailable");
    expect(logged).toContain("AccessDeniedException");
    expect(logged).not.toContain(a);
    expect(logged).not.toContain("362544434697");
  });

  it.each([null, "text", { tasks: "no", failures: [] }, { tasks: [], failures: "no" }, {}])(
    "treats a malformed answer %j as unproven",
    async (answer) => {
      const { observer: seen } = observer(() => answer);
      expect((await seen.absent([a])).size).toBe(0);
    },
  );

  it.each([
    [[]],
    [["not an arn"]],
    [[cluster, "arn:aws:ecs:eu-west-1:362544434697:cluster/x"]],
    [Array.from({ length: 9 }, (_, index) => `${cluster}${index}`)],
  ])("refuses an invalid cluster configuration %j", (clusterArns) => {
    expect(() => createNativeTaskAbsenceObserver({ clusterArns })).toThrow(
      "NativeTaskAbsenceConfigurationInvalid",
    );
  });
});
