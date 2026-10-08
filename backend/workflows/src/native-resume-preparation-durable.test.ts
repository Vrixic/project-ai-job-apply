import type { NativeResumePreparationControlInput } from "@ai-job-apply/documents-service/native-resume-preparation-control-contract";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createNativeResumePreparationDurableHandler } from "./native-resume-preparation-durable.js";
import { createNativeResumePreparationDurableLambda } from "./native-resume-preparation-durable-lambda.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-preparation:9";
const deployment = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:1",
  containerName: "resume",
};
const start: NativeResumePreparationControlInput = {
  schemaVersion: 1,
  action: "start",
  reservation: {
    identity: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      version: 1,
      baseDocumentId: id(4),
      baseVersion: 1,
      baseSha256: "a".repeat(64),
      jobContextSha256: "b".repeat(64),
    },
    application: {
      ownerUserId: id(1),
      applicationId: id(2),
      canonicalJobId: id(5),
      expectedRevision: 2,
      packetId: id(6),
      packetHash: "c".repeat(64),
      jobRevision: "d".repeat(64),
    },
    normalizedSha256: "e".repeat(64),
    previousEpochId: null,
    deployment,
  },
};
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(3),
  allocationId: id(7),
  epochId: id(8),
};

beforeAll(async () => {
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
});
afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
});
function reply(request: NativeResumePreparationControlInput, ready = false) {
  return {
    schemaVersion: 1,
    request,
    scope,
    outcome: request.action === "start" ? "reserved" : ready ? "ready" : "pending",
    packet: ready ? { id: id(9), revision: 3 } : null,
  };
}
it("checkpoints original reservation and polls the same scope without repeating start", async () => {
  const calls: NativeResumePreparationControlInput[] = [];
  const runner = new LocalDurableTestRunner({
    handlerFunction: createNativeResumePreparationDurableHandler(target),
  });
  runner.registerFunction(target, async (raw) => {
    const request = raw as NativeResumePreparationControlInput;
    calls.push(request);
    return reply(request, calls.length === 4);
  });
  const result = await runner.run({ payload: start });
  expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  expect(result.getResult()).toMatchObject({ outcome: "ready", scope, packet: { revision: 3 } });
  expect(calls).toEqual([start, ...Array(3).fill({ schemaVersion: 1, action: "complete", scope })]);
  expect(result.getInvocations().length).toBeGreaterThan(1);
  expect(runner.getOperation("native-resume.reserve.v1.attempt-1")).toBeDefined();
  expect(runner.getOperation("native-resume.complete.v1.attempt-3")).toBeDefined();
});
it.each(["success", "lost-delete", "lost-attachment"])(
  "routes original preparation and reports %s",
  async (mode) => {
    const route = {
      intent: {
        allocationId: scope.allocationId,
        publicIp: "54.0.0.1",
        hostedZoneId: "ZSYNTHETIC123",
        baseHost: "resumes.example.com",
      },
      expiresAtMs: Date.now() + 1_800_000,
    };
    const calls: string[] = [];
    let present = false,
      propagated = false;
    const handler = createNativeResumePreparationDurableHandler(target, {
      enabled: () => true,
      creationEnabled: () => true,
      testControlClient: {
        send: async (command) => {
          const payload = command.input.Payload;
          if (!(payload instanceof Uint8Array)) throw Error("SyntheticPayloadExpected");
          const request = JSON.parse(
            new TextDecoder().decode(payload),
          ) as NativeResumePreparationControlInput;
          calls.push(request.action);
          const outcome =
            request.action === "route_admit"
              ? "admitted"
              : request.action === "route_retired"
                ? "retired"
                : "ready";
          if (request.action === "complete") {
            expect(propagated).toBe(true);
            if (mode === "lost-attachment") throw Error("SyntheticLostAttachmentAck");
          }
          return {
            StatusCode: 200,
            ExecutedVersion: "9",
            Payload: new TextEncoder().encode(
              JSON.stringify({
                schemaVersion: 1,
                request,
                outcome,
                scope,
                packet: outcome === "ready" ? { id: id(9), revision: 3 } : null,
              }),
            ),
          };
        },
      },
      testRoute: (observed) => {
        expect(observed).toEqual(route.intent);
        return {
          create: async () => {
            calls.push("dns-create");
            present = true;
            return { changeId: "/change/CCREATE", status: "PENDING" };
          },
          status: async (changeId) => {
            propagated = true;
            return { changeId, status: "INSYNC" };
          },
          inspect: async () => ({ kind: present ? "present" : "absent" }),
          remove: async () => {
            calls.push("dns-remove");
            present = false;
            if (mode === "lost-delete") throw Error("SyntheticLostDeleteAck");
            return { changeId: "/change/CDELETE", status: "PENDING" };
          },
        };
      },
    });
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFunction(target, async (raw) => {
      const request = raw as NativeResumePreparationControlInput;
      calls.push(request.action);
      if (request.action === "start") return reply(request);
      expect(request.action).toBe("route_capture");
      return { schemaVersion: 1, request, outcome: "route_captured", scope, packet: null, route };
    });
    const result = await runner.run({ payload: start });
    expect(result.getStatus()).toBe(
      mode === "success" ? ExecutionStatus.SUCCEEDED : ExecutionStatus.FAILED,
    );
    if (mode === "success")
      expect(result.getResult()).toMatchObject({
        outcome: "route_lifecycle_finished",
        cleanup: "removed",
        attachment: "acknowledged",
      });
    else
      expect(result.getError()).toMatchObject({
        errorMessage:
          mode === "lost-delete"
            ? "NativeResumeRouteCleanupUnresolved"
            : "NativeResumeRoutePreparationIncomplete",
      });
    expect(calls).toEqual([
      "start",
      "route_capture",
      "route_admit",
      "dns-create",
      "route_admit",
      "complete",
      "route_retired",
      "dns-remove",
    ]);
  },
);
it("retries an unavailable start using the identical original reservation", async () => {
  const calls: NativeResumePreparationControlInput[] = [];
  const runner = new LocalDurableTestRunner({
    handlerFunction: createNativeResumePreparationDurableHandler(target),
  });
  runner.registerFunction(target, async (raw) => {
    const request = raw as NativeResumePreparationControlInput;
    calls.push(request);
    if (calls.length === 1) return { ...reply(request), outcome: "unavailable", scope: null };
    return reply(request, request.action === "complete");
  });
  expect((await runner.run({ payload: start })).getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  expect(calls).toEqual([start, start, { schemaVersion: 1, action: "complete", scope }]);
});
it.each(["foreign", "content"])(
  "rejects %s responses without retrying or regenerating",
  async (mode) => {
    const call = vi.fn(async (raw: unknown) => {
      const result = reply(raw as NativeResumePreparationControlInput);
      return mode === "foreign"
        ? { ...result, scope: { ...scope, ownerUserId: id(99) } }
        : { ...result, content: "synthetic forbidden" };
    });
    const runner = new LocalDurableTestRunner({
      handlerFunction: createNativeResumePreparationDurableHandler(target),
    });
    runner.registerFunction(target, call);
    expect((await runner.run({ payload: start })).getStatus()).toBe(ExecutionStatus.FAILED);
    expect(call).toHaveBeenCalledTimes(1);
  },
);
it("bounds pending completion without compensating, renewing or launching again", async () => {
  const calls: NativeResumePreparationControlInput[] = [];
  const runner = new LocalDurableTestRunner({
    handlerFunction: createNativeResumePreparationDurableHandler(target),
  });
  runner.registerFunction(target, async (raw) => {
    const request = raw as NativeResumePreparationControlInput;
    calls.push(request);
    return reply(request);
  });
  expect((await runner.run({ payload: start })).getStatus()).toBe(ExecutionStatus.FAILED);
  expect(calls).toEqual([
    start,
    ...Array(15).fill({ schemaVersion: 1, action: "complete", scope }),
  ]);
});
it("rejects malformed workflow input before invocation", async () => {
  const call = vi.fn();
  const runner = new LocalDurableTestRunner({
    handlerFunction: createNativeResumePreparationDurableHandler(target),
  });
  runner.registerFunction(target, call);
  expect((await runner.run({ payload: { ...start, content: "synthetic" } })).getStatus()).toBe(
    ExecutionStatus.FAILED,
  );
  expect(call).not.toHaveBeenCalled();
});
it("requires a pinned numeric control target and stays disabled by default", async () => {
  expect(() =>
    createNativeResumePreparationDurableHandler(target.replace(/:9$/u, ":live")),
  ).toThrow();
  const handler = createNativeResumePreparationDurableLambda({ environment: () => ({}) });
  await expect(handler({} as never, { invokedFunctionArn: target } as never)).rejects.toThrow(
    "NativeResumePreparationWorkflowUnavailable",
  );
});
