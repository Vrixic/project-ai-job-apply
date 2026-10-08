import { createNativeResumeDnsRoute } from "@ai-job-apply/documents-service/native-resume-dns-route";
import {
  type DurableContext,
  StepInterruptedError,
  StepSemantics,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNativeMaterialRouteLifecycle } from "./native-material-route-lifecycle.js";
import { createNativeResumeRouteLifecycle } from "./native-resume-route-lifecycle.js";

const scope = {
  ownerUserId: "019d04cf-1f80-7000-8000-000000000101",
  applicationId: "019d04cf-1f80-7000-8000-000000000102",
  generationId: "019d04cf-1f80-7000-8000-000000000103",
  allocationId: "019d04cf-1f80-7000-8000-000000000104",
  epochId: "019d04cf-1f80-7000-8000-000000000105",
};
const intent = {
  allocationId: scope.allocationId,
  publicIp: "54.0.0.1",
  hostedZoneId: "ZSYNTHETIC123",
  baseHost: "resumes.example.com",
};
beforeAll(async () => {
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
});
afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
});
describe.each(["resume", "material"] as const)("%s original route lifecycle", (kind) => {
  const createLifecycle =
    kind === "resume" ? createNativeResumeRouteLifecycle : createNativeMaterialRouteLifecycle;
  function setup() {
    let present = false;
    const create = vi.fn(async () => {
      present = true;
      return { changeId: "/change/CCREATE", status: "PENDING" as const };
    });
    const remove = vi.fn(async () => {
      present = false;
      return { changeId: "/change/CDELETE", status: "PENDING" as const };
    });
    const inspect = vi.fn(async () => ({
      kind: present ? ("present" as const) : ("absent" as const),
    }));
    const status = vi.fn(async (id: string) => ({ changeId: id, status: "INSYNC" as const }));
    const capture = vi.fn(async () => ({
      intent: { ...intent },
      expiresAtMs: Date.now() + 1_800_000,
    }));
    const admit = vi.fn(async () => true),
      attach = vi.fn(async () => undefined),
      retired = vi.fn(async () => true);
    const enabled = vi.fn(() => true),
      creationEnabled = vi.fn(() => true);
    const testRoute = vi.fn<
      NonNullable<Parameters<typeof createNativeResumeRouteLifecycle>[0]["testRoute"]>
    >(() => ({ create, remove, inspect, status }));
    const options = { capture, admit, attach, retired, enabled, creationEnabled, testRoute };
    const run = async (interrupted?: "create" | "remove" | "attach") => {
      const lifecycle = createLifecycle(options);
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(async (_input, context) => {
          const step = context.step.bind(context);
          const wrapped = new Proxy(context, {
            get(target, key) {
              if (key !== "step") return Reflect.get(target, key);
              return ((...args: unknown[]) => {
                if (args[0] === `${kind}-route.${interrupted}.v1`) {
                  const config = args[2] as {
                    semantics: StepSemantics;
                    retryStrategy: () => { shouldRetry: boolean };
                  };
                  expect(config.semantics).toBe(StepSemantics.AtMostOncePerRetry);
                  expect(config.retryStrategy()).toEqual({ shouldRetry: false });
                  if (interrupted === "create") present = true;
                  if (interrupted === "remove") present = false;
                  throw new StepInterruptedError("synthetic-operation", String(args[0]));
                }
                return Reflect.apply(step, context, args);
              }) as DurableContext["step"];
            },
          });
          return lifecycle(wrapped, scope);
        }),
      });
      const result = await runner.run({ payload: { scope } });
      return { runner, result };
    };
    return {
      create,
      remove,
      inspect,
      status,
      capture,
      admit,
      attach,
      retired,
      enabled,
      creationEnabled,
      options,
      run,
      setPresent(value: boolean) {
        present = value;
      },
    };
  }
  it("checkpoints the original intent and runs the actual DNS adapter through attachment and cleanup", async () => {
    const x = setup();
    let record: unknown;
    let polls = 0;
    const sends: string[] = [];
    x.options.testRoute.mockImplementation((original) =>
      createNativeResumeDnsRoute({
        intent: original,
        enabled: x.enabled,
        creationEnabled: x.creationEnabled,
        testClient: {
          send: async (command) => {
            sends.push(command.constructor.name);
            if ("ChangeBatch" in command.input) {
              const change = command.input.ChangeBatch?.Changes?.[0];
              expect(command.input.HostedZoneId).toBe(intent.hostedZoneId);
              expect(change?.ResourceRecordSet?.ResourceRecords).toEqual([
                { Value: intent.publicIp },
              ]);
              record = change?.Action === "CREATE" ? change.ResourceRecordSet : undefined;
              return {
                ChangeInfo: {
                  Id: record ? "/change/CCREATE" : "/change/CDELETE",
                  Status: "PENDING",
                },
              };
            }
            if ("Id" in command.input)
              return {
                ChangeInfo: { Id: command.input.Id, Status: ++polls === 1 ? "PENDING" : "INSYNC" },
              };
            return { ResourceRecordSets: record ? [record] : [], IsTruncated: false };
          },
        },
      }),
    );
    x.retired.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, runner } = await x.run();
    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toEqual({
      allocationId: scope.allocationId,
      cleanup: "removed",
      attachment: "acknowledged",
    });
    expect(x.capture).toHaveBeenCalledOnce();
    expect(x.attach).toHaveBeenCalledOnce();
    expect(x.admit).toHaveBeenCalledTimes(2);
    expect(sends.filter((name) => name === "ChangeResourceRecordSetsCommand")).toHaveLength(2);
    expect(result.getInvocations().length).toBeGreaterThan(1);
    expect(runner.getOperation(`${kind}-route.intent.v1`)).toBeDefined();
    expect(runner.getOperation(`${kind}-route.create.v1`)).toBeDefined();
    expect(runner.getOperation(`${kind}-route.remove.v1`)).toBeDefined();
  });
  it.each(["creation off", "owner refused", "owner unavailable"])(
    "does not send DNS when %s",
    async (kind) => {
      const x = setup();
      if (kind === "creation off") x.creationEnabled.mockReturnValue(false);
      if (kind === "owner refused") x.admit.mockResolvedValue(false);
      if (kind === "owner unavailable") x.admit.mockRejectedValue(Error("synthetic private error"));
      const { result } = await x.run();
      expect(result.getResult()).toMatchObject({
        cleanup: "not_created",
        attachment: "not_attempted",
      });
      expect(x.create).not.toHaveBeenCalled();
      expect(x.remove).not.toHaveBeenCalled();
    },
  );
  it("keeps cleanup active with new creation withdrawn after its original write", async () => {
    const x = setup();
    x.create.mockImplementation(async () => {
      x.setPresent(true);
      x.creationEnabled.mockReturnValue(false);
      return { changeId: "/change/CCREATE", status: "PENDING" };
    });
    const { result } = await x.run();
    expect(result.getResult()).toMatchObject({ cleanup: "removed" });
    expect(x.create).toHaveBeenCalledOnce();
    expect(x.remove).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "recovers an unknown creation only with positive original presence (%s)",
    async (present) => {
      const x = setup();
      x.create.mockImplementation(async () => {
        x.setPresent(present);
        throw Error("synthetic lost acknowledgement");
      });
      const { result } = await x.run();
      expect(result.getResult()).toMatchObject({
        cleanup: present ? "removed" : "unresolved",
        attachment: "not_attempted",
      });
      expect(x.create).toHaveBeenCalledOnce();
      expect(x.attach).not.toHaveBeenCalled();
      expect(x.remove).toHaveBeenCalledTimes(present ? 1 : 0);
    },
  );
  it("does not declare cleanup complete when DELETE acknowledgement is lost", async () => {
    const x = setup();
    x.remove.mockImplementation(async () => {
      x.setPresent(false);
      throw Error("synthetic unknown delete");
    });
    const { result } = await x.run();
    expect(result.getResult()).toMatchObject({ cleanup: "unresolved", attachment: "acknowledged" });
    expect(x.remove).toHaveBeenCalledOnce();
  });
  it("retains cleanup when attachment acknowledgement is lost", async () => {
    const x = setup();
    x.attach.mockRejectedValue(Error("synthetic unknown attachment"));
    const { result } = await x.run();
    expect(result.getResult()).toMatchObject({ cleanup: "removed", attachment: "unresolved" });
    expect(x.attach).toHaveBeenCalledOnce();
  });
  it("rechecks owner admission before attachment but still removes the original DNS route", async () => {
    const x = setup();
    x.admit.mockResolvedValueOnce(true).mockResolvedValue(false);
    const { result } = await x.run();
    expect(result.getResult()).toMatchObject({ cleanup: "removed", attachment: "not_attempted" });
    expect(x.attach).not.toHaveBeenCalled();
  });
  it("refuses foreign allocation capture before any DNS or attachment", async () => {
    const x = setup();
    x.capture.mockResolvedValue({
      intent: { ...intent, allocationId: scope.generationId },
      expiresAtMs: Date.now() + 60000,
    });
    const { result } = await x.run();
    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(x.create).not.toHaveBeenCalled();
    expect(x.attach).not.toHaveBeenCalled();
  });
  it("keeps a propagation failure unresolved without resending a DNS mutation", async () => {
    const x = setup();
    x.status.mockImplementation(async (id) => {
      if (id === "/change/CDELETE") throw Error("synthetic unavailable");
      return { changeId: id, status: "INSYNC" };
    });
    const { result } = await x.run();
    expect(result.getResult()).toMatchObject({ cleanup: "unresolved" });
    expect(x.remove).toHaveBeenCalledOnce();
    expect(x.status.mock.calls.filter(([id]) => id === "/change/CDELETE")).toHaveLength(12);
  });
  it.each(["create", "remove"] as const)(
    "does not reexecute an SDK-interrupted %s step",
    async (interrupted) => {
      const x = setup();
      const { result } = await x.run(interrupted);
      expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      expect(result.getResult()).toMatchObject({
        cleanup: interrupted === "create" ? "removed" : "unresolved",
      });
      expect(x.create).toHaveBeenCalledTimes(interrupted === "create" ? 0 : 1);
      expect(x.remove).toHaveBeenCalledTimes(interrupted === "remove" ? 0 : 1);
    },
  );
  it("retains an interrupted attachment as unresolved and continues DNS cleanup", async () => {
    const x = setup();
    const { result } = await x.run("attach");
    expect(result.getResult()).toMatchObject({ cleanup: "removed", attachment: "unresolved" });
    expect(x.attach).not.toHaveBeenCalled();
    expect(x.remove).toHaveBeenCalledOnce();
  });
  it("removes an expired route without treating expiry as positive task retirement", async () => {
    const x = setup();
    x.capture.mockImplementation(async () => ({ intent, expiresAtMs: Date.now() + 2_000 }));
    x.status.mockResolvedValueOnce({ changeId: "/change/CCREATE", status: "INSYNC" });
    x.retired.mockImplementation(async () => {
      // The test's owner clock moves beyond the original expiry; task death remains unknown.
      const prior = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(prior + 3_000);
      return false;
    });
    try {
      const { result } = await x.run();
      expect(result.getResult()).toMatchObject({ cleanup: "removed" });
      expect(x.remove).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
