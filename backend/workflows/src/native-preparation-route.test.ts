import type {
  PreparationActivityStore,
  PreparationRecord,
} from "@ai-job-apply/applications-service";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNativePreparationRouteActivity } from "./native-preparation-route-activity.js";
import {
  type NativePreparationRouteInput,
  validateNativePreparationRouteInput,
  validateNativePreparationRouteOutput,
} from "./native-preparation-route-contract.js";
import { createNativePreparationRouteWorkflow } from "./native-preparation-route-durable.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  allocationId: id(1),
  ownerUserId: id(2),
  applicationId: id(3),
  generationId: id(4),
  epochId: id(5),
};
const binding = {
  scope,
  allocation: {
    allocationId: scope.allocationId,
    ownerUserId: scope.ownerUserId,
    applicationId: scope.applicationId,
    generationId: scope.generationId,
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/material",
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/material:7",
    containerName: "native-material",
    taskArn: "arn:aws:ecs:us-east-2:123456789012:task/material/12345678901234567890123456789012",
  },
  original: {
    id: id(6),
    documentId: scope.generationId,
    purpose: "provider_dispatch" as const,
    requestSha256: "a".repeat(64),
  },
};
const stage = {
  schemaVersion: 1 as const,
  protocol: "native-preparation-route.v1" as const,
  eventId: id(7),
  preparationId: scope.generationId,
  action: "stage" as const,
};
function fixture() {
  const now = Date.now();
  const reference = {
    schemaVersion: 1 as const,
    kind: "cover_letter" as const,
    ownerUserId: scope.ownerUserId,
    applicationId: scope.applicationId,
    generationId: scope.generationId,
    version: 2,
    contentSha256: "b".repeat(64),
    completedAtMs: now,
    expiresAtMs: now + 1_800_000,
  };
  let target: PreparationRecord = {
    id: scope.generationId,
    ownerUserId: scope.ownerUserId,
    applicationId: scope.applicationId,
    basePacketId: id(8),
    expectedRevision: 2,
    jobContextHash: "c".repeat(64),
    confirmedFactsHash: "d".repeat(64),
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: new Date(now),
    expiresAt: new Date(now + 900_000),
    generationClaimedAt: null,
    state: "queued",
    resultPacketId: null,
    errorCode: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  const store = {
    getPreparationForEvent: vi.fn(async () => target),
    getPreparationVaultReferences: vi.fn(async () => []),
    claimPreparationGeneration: vi.fn<PreparationActivityStore["claimPreparationGeneration"]>(
      async () => {
        const kind = target.generationClaimedAt ? "already_claimed" : "claimed";
        target = { ...target, state: "running", generationClaimedAt: new Date(now) };
        return { kind, preparation: target };
      },
    ),
    completePreparation: vi.fn<PreparationActivityStore["completePreparation"]>(
      async () => (target = { ...target, state: "succeeded" }),
    ),
    failPreparation: vi.fn<PreparationActivityStore["failPreparation"]>(
      async () => (target = { ...target, state: "failed" }),
    ),
  };
  const letter = {
    temporaryMaterial: reference,
    contentSha256: reference.contentSha256,
    sourceFactIds: [id(9)],
    confidence: 1,
  };
  const documents = {
    context: vi.fn(async () => ({
      jobContextHash: target.jobContextHash,
      confirmedFactsHash: target.confirmedFactsHash,
    })),
    recover: vi.fn(async () => letter),
    generate: vi.fn(async () => ({ kind: "ready" as const, letter })),
  };
  const ready = { readBinding: vi.fn(async () => binding) };
  const options = { store, documents, ready, enabled: () => true };
  return {
    store,
    documents,
    ready,
    reference,
    options,
    run: createNativePreparationRouteActivity(options),
  };
}
describe("original preparation stage and attach", () => {
  it("stages once without packet writes and reloads context for original-only attachment", async () => {
    const f = fixture();
    const first = await f.run(stage);
    expect(first.outcome).toBe("ready");
    expect(validateNativePreparationRouteOutput(first)).toBe(true);
    expect(await f.run(stage)).toEqual(first);
    expect(f.store.completePreparation).not.toHaveBeenCalled();
    expect(f.documents.generate).toHaveBeenCalledOnce();
    if (!first.original) throw Error("missing original");
    f.documents.context.mockResolvedValue({
      jobContextHash: "e".repeat(64),
      confirmedFactsHash: "f".repeat(64),
    });
    const attach = { ...stage, action: "attach" as const, original: first.original };
    expect((await f.run(attach)).outcome).toBe("attached");
    expect(f.store.completePreparation.mock.calls[0]?.[2]).toEqual({
      jobContextHash: "e".repeat(64),
      confirmedFactsHash: "f".repeat(64),
    });
    expect(f.documents.generate).toHaveBeenCalledOnce();
    expect((await f.run(attach)).outcome).toBe("terminal");
    expect(f.store.completePreparation).toHaveBeenCalledOnce();
  });
  it("refuses a changed ready reference without attaching or regenerating", async () => {
    const f = fixture();
    const first = await f.run(stage);
    if (!first.original) throw Error("missing original");
    f.reference.version++;
    await expect(f.run({ ...stage, action: "attach", original: first.original })).rejects.toThrow(
      "NativePreparationRouteUnavailable",
    );
    expect(f.store.completePreparation).not.toHaveBeenCalled();
    expect(f.documents.generate).toHaveBeenCalledOnce();
  });
  it("refuses attachment before an original generation claim", async () => {
    const f = fixture();
    expect(
      (await f.run({ ...stage, action: "attach", original: { binding, reference: f.reference } }))
        .outcome,
    ).toBe("terminal");
    expect(f.documents.generate).not.toHaveBeenCalled();
    expect(f.store.completePreparation).not.toHaveBeenCalled();
  });
  it("defaults off before I/O and rejects extra input and accessor fields", async () => {
    const f = fixture();
    const { enabled: _, ...off } = f.options;
    await expect(createNativePreparationRouteActivity(off)(stage)).rejects.toThrow(
      "NativePreparationRouteUnavailable",
    );
    expect(f.store.getPreparationForEvent).not.toHaveBeenCalled();
    expect(validateNativePreparationRouteInput({ ...stage, text: "synthetic" })).toBe(false);
    const getter = vi.fn();
    expect(
      validateNativePreparationRouteInput(
        Object.defineProperty({ ...stage }, "action", { get: getter }),
      ),
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("connected original preparation durable route", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });
  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });
  it.each(["success", "lost attach acknowledgement", "creation disabled", "pending stage"])(
    "handles %s with original-only effects",
    async (kind) => {
      const f = fixture();
      let present = false;
      const effects: string[] = [];
      const route = {
        intent: {
          allocationId: scope.allocationId,
          publicIp: "54.0.0.1",
          hostedZoneId: "ZSYNTHETIC123",
          baseHost: "materials.example.com",
        },
        expiresAtMs: f.reference.expiresAtMs,
      };
      const activityArn = "arn:aws:lambda:us-east-2:123456789012:function:preparation-activity:7";
      const controlArn = "arn:aws:lambda:us-east-2:123456789012:function:material-control:9";
      const workflow = createNativePreparationRouteWorkflow({
        activityArn,
        controlArn,
        enabled: () => true,
        creationEnabled: () => kind !== "creation disabled",
        testActivityClient: {
          send: async (command) => {
            if (!(command.input.Payload instanceof Uint8Array)) throw Error("invalid payload");
            const input = JSON.parse(
              new TextDecoder().decode(command.input.Payload),
            ) as NativePreparationRouteInput;
            effects.push(input.action);
            const result = await f.run(input);
            if (kind === "lost attach acknowledgement") throw Error("synthetic lost ACK");
            return {
              StatusCode: 200,
              ExecutedVersion: "7",
              Payload: new TextEncoder().encode(JSON.stringify(result)),
            };
          },
        },
        testControlClient: {
          send: async (command) => {
            if (!(command.input.Payload instanceof Uint8Array)) throw Error("invalid payload");
            const request = JSON.parse(new TextDecoder().decode(command.input.Payload));
            expect(request.binding).toEqual(binding);
            expect(request.reference).toEqual(f.reference);
            effects.push(request.action);
            return {
              StatusCode: 200,
              ExecutedVersion: "9",
              Payload: new TextEncoder().encode(
                JSON.stringify({
                  schemaVersion: 1,
                  request,
                  outcome:
                    request.action === "capture"
                      ? "captured"
                      : request.action === "admit"
                        ? "admitted"
                        : "retired",
                  route: request.action === "capture" ? route : null,
                }),
              ),
            };
          },
        },
        testRoute: () => ({
          create: async () => {
            effects.push("create");
            present = true;
            return { changeId: "/change/CCREATE", status: "PENDING" };
          },
          remove: async () => {
            effects.push("remove");
            present = false;
            return { changeId: "/change/CDELETE", status: "PENDING" };
          },
          inspect: async () => ({ kind: present ? "present" : "absent" }),
          status: async (changeId) => {
            effects.push("propagated");
            return { changeId, status: "INSYNC" };
          },
        }),
      });
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(workflow),
      });
      let first = true;
      runner.registerFunction(activityArn, async (raw) => {
        const input = raw as NativePreparationRouteInput;
        effects.push(input.action);
        if (kind === "pending stage" && first) {
          first = false;
          return { schemaVersion: 1, request: input, outcome: "pending", original: null };
        }
        return f.run(input);
      });
      const result = await runner.run({
        payload: {
          schemaVersion: 1,
          eventId: stage.eventId,
          eventType: "application.packet-preparation.requested.v1",
          data: { preparationId: stage.preparationId },
        },
      });
      expect(result.getStatus()).toBe(
        ["success", "pending stage"].includes(kind)
          ? ExecutionStatus.SUCCEEDED
          : ExecutionStatus.FAILED,
      );
      expect(f.documents.generate).toHaveBeenCalledOnce();
      if (kind === "creation disabled") {
        expect(effects).not.toContain("create");
        expect(f.store.completePreparation).not.toHaveBeenCalled();
      } else {
        expect(effects.filter((x) => x === "create")).toHaveLength(1);
        expect(effects.filter((x) => x === "attach")).toHaveLength(1);
        expect(effects.indexOf("propagated")).toBeLessThan(effects.indexOf("attach"));
        expect(effects).toContain("remove");
        expect(present).toBe(false);
        expect(f.store.completePreparation).toHaveBeenCalledOnce();
      }
      expect(effects.includes("fail")).toBe(!["success", "pending stage"].includes(kind));
    },
  );
});
