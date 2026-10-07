import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeMaterialTaskEventHandler,
  createNativeMaterialTaskEventLambda,
  handler,
} from "./native-material-task-event-lambda.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const config = {
  functionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-launch:9",
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
  containerName: "material",
};
const taskArn = `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`;
const ownTarget = "arn:aws:lambda:us-east-2:123456789012:function:native-events:7";
function event() {
  return {
    version: "0",
    id: id(9),
    source: "aws.ecs",
    "detail-type": "ECS Task State Change",
    account: "123456789012",
    region: "us-east-2",
    time: "2026-10-06T14:00:00Z",
    resources: [taskArn],
    detail: {
      clusterArn: config.clusterArn,
      taskDefinitionArn: config.taskDefinitionArn,
      taskArn,
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      enableExecuteCommand: false,
      lastStatus: "RUNNING",
      version: 3,
      overrides: {
        containerOverrides: [
          {
            name: config.containerName,
            environment: [
              ...[
                "ALLOCATION_ID",
                "OWNER_USER_ID",
                "APPLICATION_ID",
                "GENERATION_ID",
                "EPOCH_ID",
                "WORK_ID",
              ].map((name, i) => ({ name: `NATIVE_MATERIAL_${name}`, value: id(i + 1) })),
              { name: "NATIVE_MATERIAL_REQUEST_SHA256", value: "b".repeat(64) },
            ],
          },
        ],
      },
      attachments: [{ type: "eni", details: [{ name: "privateIPv4Address", value: "10.0.1.2" }] }],
    },
  };
}
function container(value: ReturnType<typeof event>) {
  const found = value.detail.overrides.containerOverrides[0];
  if (!found) throw Error("SyntheticContainerMissing");
  return found;
}
function environmentEntry(value: ReturnType<typeof event>, index: number) {
  const found = container(value).environment[index];
  if (!found) throw Error("SyntheticEnvironmentMissing");
  return found;
}
function transport() {
  return {
    send: vi.fn(async (command: InvokeCommand) => {
      const request = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
      return {
        StatusCode: 200,
        ExecutedVersion: "9",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: 1,
            request,
            outcome: "captured",
            capture: {
              scope: request.scope,
              allocation: {
                allocationId: id(1),
                ownerUserId: id(2),
                applicationId: id(3),
                generationId: id(4),
                clusterArn: config.clusterArn,
                taskDefinitionArn: config.taskDefinitionArn,
                containerName: config.containerName,
                taskArn,
              },
            },
          }),
        ),
      };
    }),
  };
}
function environment() {
  return {
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_SESSION_TOKEN: "synthetic-unused",
    AWS_LAMBDA_FUNCTION_NAME: "native-events",
    AWS_LAMBDA_FUNCTION_VERSION: "7",
    NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED: "true",
    NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON: JSON.stringify(config),
  } as Record<string, string | undefined>;
}
afterEach(() => vi.unstubAllEnvs());
describe("native task event positive-recovery routing", () => {
  it("defaults off and emits no transport request", async () => {
    const client = transport();
    await expect(
      createNativeMaterialTaskEventHandler({ configuration: config, testClient: client })(event()),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).not.toHaveBeenCalled();
  });
  it.each(["RUNNING", "STOPPED", "PROVISIONING"])(
    "routes %s only to original positive recovery and returns scalar acknowledgement",
    async (state) => {
      const client = transport();
      const value = event();
      value.detail.lastStatus = state;
      const receiver = createNativeMaterialTaskEventHandler({
        configuration: config,
        enabled: () => true,
        testClient: client,
      });
      await expect(receiver(value)).resolves.toEqual({
        schemaVersion: 1,
        outcome: "captured",
        eventId: id(9),
        allocationId: id(1),
        taskArn,
      });
      const command = client.send.mock.calls[0]?.[0];
      expect(command?.input).toMatchObject({
        FunctionName: config.functionArn,
        InvocationType: "RequestResponse",
        LogType: "None",
      });
      const payload = JSON.parse(new TextDecoder().decode(command?.input.Payload as Uint8Array));
      expect(payload).toEqual({
        schemaVersion: 1,
        action: "recover",
        scope: {
          allocationId: id(1),
          ownerUserId: id(2),
          applicationId: id(3),
          generationId: id(4),
          epochId: id(5),
        },
        taskArn,
      });
      expect(Object.keys(payload)).not.toContain("detail");
    },
  );
  const refused: [string, (value: ReturnType<typeof event>) => void][] = [
    [
      "source",
      (v) => {
        v.source = "aws.lambda";
      },
    ],
    [
      "account",
      (v) => {
        v.account = "999999999999";
      },
    ],
    [
      "region",
      (v) => {
        v.region = "us-east-1";
      },
    ],
    [
      "type",
      (v) => {
        v["detail-type"] = "Other";
      },
    ],
    [
      "event ID",
      (v) => {
        v.id = "secret";
      },
    ],
    [
      "timestamp",
      (v) => {
        v.time = "invalid";
      },
    ],
    [
      "resource",
      (v) => {
        v.resources = [`${taskArn}a`];
      },
    ],
    [
      "multiple resources",
      (v) => {
        v.resources.push(taskArn);
      },
    ],
    [
      "cluster",
      (v) => {
        v.detail.clusterArn += "-other";
      },
    ],
    [
      "task revision",
      (v) => {
        v.detail.taskDefinitionArn += "1";
      },
    ],
    [
      "task ARN",
      (v) => {
        v.detail.taskArn += "a";
      },
    ],
    [
      "Exec",
      (v) => {
        v.detail.enableExecuteCommand = true;
      },
    ],
    [
      "launch type",
      (v) => {
        v.detail.launchType = "EC2";
      },
    ],
    [
      "platform",
      (v) => {
        v.detail.platformVersion = "LATEST";
      },
    ],
    [
      "state",
      (v) => {
        v.detail.lastStatus = "MISSING";
      },
    ],
    [
      "sequence",
      (v) => {
        v.detail.version = 0;
      },
    ],
    [
      "container",
      (v) => {
        container(v).name = "other";
      },
    ],
    [
      "extra container",
      (v) => {
        v.detail.overrides.containerOverrides.push(container(v));
      },
    ],
    [
      "duplicate environment",
      (v) => {
        const e = container(v).environment;
        e[1] = environmentEntry(v, 0);
      },
    ],
    [
      "extra environment",
      (v) => {
        container(v).environment.push({
          name: "DATABASE_URL",
          value: "synthetic",
        });
      },
    ],
    [
      "invalid native ID",
      (v) => {
        environmentEntry(v, 0).value = "invalid";
      },
    ],
    [
      "invalid hash",
      (v) => {
        environmentEntry(v, 6).value = "invalid";
      },
    ],
    [
      "command override",
      (v) => {
        Object.assign(container(v), { command: ["retarget"] });
      },
    ],
    [
      "role override",
      (v) => {
        Object.assign(v.detail.overrides, { taskRoleArn: "retarget" });
      },
    ],
    [
      "foreign startedBy",
      (v) => {
        Object.assign(v.detail, { startedBy: id(88) });
      },
    ],
    [
      "oversized JSON",
      (v) => {
        Object.assign(v.detail, { metadata: "x".repeat(65_536) });
      },
    ],
    [
      "hidden field",
      (v) => {
        Object.defineProperty(v, "hidden", { value: "synthetic" });
      },
    ],
    [
      "symbol",
      (v) => {
        Object.assign(v.detail, { [Symbol("x")]: "synthetic" });
      },
    ],
    [
      "custom prototype",
      (v) => {
        Object.setPrototypeOf(v.detail, { foreign: true });
      },
    ],
  ];
  it.each(refused)("rejects %s before Invoke", async (_name, alter) => {
    const value = event();
    alter(value);
    const client = transport();
    await expect(
      createNativeMaterialTaskEventHandler({
        configuration: config,
        enabled: () => true,
        testClient: client,
      })(value),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("does not invoke nested getters or toJSON", async () => {
    const get = vi.fn();
    const value = event();
    Object.defineProperty(value.detail, "text", { enumerable: true, get });
    await expect(
      createNativeMaterialTaskEventHandler({
        configuration: config,
        enabled: () => true,
        testClient: transport(),
      })(value),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(get).not.toHaveBeenCalled();
  });
  it("replays/out-of-order delivery through positive recovery without any launch", async () => {
    const client = transport();
    const receiver = createNativeMaterialTaskEventHandler({
      configuration: config,
      enabled: () => true,
      testClient: client,
    });
    const value = event();
    value.detail.version = 9;
    await receiver(value);
    value.detail.version = 2;
    await receiver(value);
    await receiver(value);
    expect(client.send).toHaveBeenCalledTimes(3);
    for (const [command] of client.send.mock.calls)
      expect(JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)).action).toBe(
        "recover",
      );
  });
  it("sanitizes lost replies, does not retry, and permits a later event recovery", async () => {
    const client = transport();
    client.send.mockRejectedValueOnce(Error("synthetic-sensitive-body"));
    const receiver = createNativeMaterialTaskEventHandler({
      configuration: config,
      enabled: () => true,
      testClient: client,
    });
    await expect(receiver(event())).rejects.toThrow(/^NativeMaterialTaskEventUnavailable$/u);
    expect(client.send).toHaveBeenCalledTimes(1);
    await receiver(event());
    expect(client.send).toHaveBeenCalledTimes(2);
  });
  it("refuses simulated transport outside test", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createNativeMaterialTaskEventHandler({ configuration: config, testClient: transport() }),
    ).toThrow();
  });
  it("does not acknowledge a STOPPED hint without positive recovery capture", async () => {
    const client = transport();
    client.send.mockImplementationOnce(async (command) => ({
      StatusCode: 200,
      ExecutedVersion: "9",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          request: JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)),
          outcome: "unavailable",
          capture: null,
        }),
      ),
    }));
    const value = event();
    value.detail.lastStatus = "STOPPED";
    await expect(
      createNativeMaterialTaskEventHandler({
        configuration: config,
        enabled: () => true,
        testClient: client,
      })(value),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("holds single-flight admission until the original transport actually settles", async () => {
    const client = transport();
    const normal = client.send.getMockImplementation();
    if (!normal) throw Error("SyntheticTransportMissing");
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.send.mockImplementationOnce(async (command) => {
      await wait;
      return normal(command);
    });
    const receive = createNativeMaterialTaskEventHandler({
      configuration: config,
      enabled: () => true,
      testClient: client,
    });
    const pending = receive(event());
    await expect(receive(event())).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).toHaveBeenCalledTimes(1);
    release?.();
    await pending;
    await receive(event());
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});
describe("managed native event receiver", () => {
  it("default export is off without any managed identity", async () => {
    vi.stubEnv("NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED", undefined);
    await expect(handler(event(), { invokedFunctionArn: ownTarget })).rejects.toThrow(
      "NativeMaterialTaskEventUnavailable",
    );
  });
  it("pins exact receiver configuration and continues independently of new launch", async () => {
    const env = environment();
    const client = transport();
    const receive = createNativeMaterialTaskEventLambda({
      environment: () => env,
      testClient: client,
    });
    env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = "false";
    await expect(receive(event(), { invokedFunctionArn: ownTarget })).resolves.toMatchObject({
      outcome: "captured",
    });
    env.NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON = JSON.stringify({
      ...config,
      functionArn: config.functionArn.replace(":9", ":10"),
    });
    await expect(receive(event(), { invokedFunctionArn: ownTarget })).rejects.toThrow(
      "NativeMaterialTaskEventUnavailable",
    );
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    "DATABASE_URL",
    "DATABASE_SECRET_ID",
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_SECRET_ID",
    "COVER_LETTER_OPENAI_SECRET_ID",
  ])("refuses forbidden %s", async (name) => {
    const env = environment();
    env[name] = "synthetic";
    const client = transport();
    await expect(
      createNativeMaterialTaskEventLambda({ environment: () => env, testClient: client })(event(), {
        invokedFunctionArn: ownTarget,
      }),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).not.toHaveBeenCalled();
  });
  it.each(["$LATEST", "8"])("refuses wrong own invoked version %s", async (version) => {
    const client = transport();
    await expect(
      createNativeMaterialTaskEventLambda({ environment, testClient: client })(event(), {
        invokedFunctionArn: ownTarget.replace(":7", `:${version}`),
      }),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("withholds acknowledgement on shutdown while remote capture succeeds", async () => {
    const env = environment();
    const client = transport();
    const normal = client.send.getMockImplementation();
    if (!normal) throw Error("SyntheticTransportMissing");
    client.send.mockImplementationOnce(async (command) => {
      const reply = await normal(command);
      env.NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED = "false";
      return reply;
    });
    await expect(
      createNativeMaterialTaskEventLambda({ environment: () => env, testClient: client })(event(), {
        invokedFunctionArn: ownTarget,
      }),
    ).rejects.toThrow("NativeMaterialTaskEventUnavailable");
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});
