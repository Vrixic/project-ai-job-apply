import {
  ChangeResourceRecordSetsCommand,
  GetChangeCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeResumeDnsRoute } from "./native-resume-dns-route.js";
import type { NativeResumeRouteIntent } from "./native-resume-route-policy.js";

const intent: NativeResumeRouteIntent = {
  allocationId: "019d04cf-1f80-7000-8000-000000000104",
  publicIp: "54.0.0.1",
  hostedZoneId: "ZSYNTHETIC123",
  baseHost: "resumes.example.com",
};
const name = `${intent.allocationId}.${intent.baseHost}.`;
const record = { Name: name, Type: "A", TTL: 30, ResourceRecords: [{ Value: intent.publicIp }] };
const changeId = "/change/CSYNTHETIC123";
type Command = ChangeResourceRecordSetsCommand | GetChangeCommand | ListResourceRecordSetsCommand;
function setup() {
  const send = vi.fn(
    async (_command: Command, _options: { abortSignal: AbortSignal }): Promise<unknown> => ({
      ChangeInfo: { Id: changeId, Status: "PENDING" },
    }),
  );
  const enabled = vi.fn(() => true);
  const creationEnabled = vi.fn(() => true);
  const options = {
    intent: structuredClone(intent),
    enabled,
    creationEnabled,
    testClient: { send },
  };
  return { send, enabled, creationEnabled, options };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("runs create, inspect, propagation and exact deletion without upsert or implicit retries", async () => {
  const x = setup();
  let present = false;
  const changes = new Map<string, string>();
  x.send.mockImplementation(async (command) => {
    if (command instanceof ChangeResourceRecordSetsCommand) {
      expect(command.input.HostedZoneId).toBe(intent.hostedZoneId);
      expect(command.input.ChangeBatch?.Changes).toHaveLength(1);
      const change = command.input.ChangeBatch?.Changes?.[0];
      expect(change?.ResourceRecordSet).toEqual(record);
      expect(change?.Action).toBe(present ? "DELETE" : "CREATE");
      present = !present;
      const id = present ? "/change/CCREATE" : "/change/CDELETE";
      changes.set(id, "PENDING");
      return { ChangeInfo: { Id: id, Status: "PENDING" } };
    }
    if (command instanceof ListResourceRecordSetsCommand) {
      expect(command.input).toEqual({
        HostedZoneId: intent.hostedZoneId,
        StartRecordName: name,
        StartRecordType: "A",
        MaxItems: 1,
      });
      return { ResourceRecordSets: present ? [structuredClone(record)] : [], IsTruncated: false };
    }
    expect(command).toBeInstanceOf(GetChangeCommand);
    return { ChangeInfo: { Id: command.input.Id, Status: changes.get(command.input.Id ?? "") } };
  });
  const route = createNativeResumeDnsRoute(x.options);
  expect(route.hostname).toBe(name.slice(0, -1));
  expect(route.intentSha256).toMatch(/^[a-f0-9]{64}$/u);
  await expect(route.inspect()).resolves.toEqual({ kind: "absent" });
  await expect(route.create()).resolves.toEqual({ changeId: "/change/CCREATE", status: "PENDING" });
  await expect(route.inspect()).resolves.toEqual({ kind: "present" });
  await expect(route.status("/change/CCREATE")).resolves.toMatchObject({ status: "PENDING" });
  changes.set("/change/CCREATE", "INSYNC");
  await expect(route.status("/change/CCREATE")).resolves.toMatchObject({ status: "INSYNC" });
  x.creationEnabled.mockReturnValue(false);
  await expect(route.create()).rejects.toThrow("NativeResumeDnsUnavailable");
  await expect(route.remove()).resolves.toEqual({ changeId: "/change/CDELETE", status: "PENDING" });
  await expect(route.inspect()).resolves.toEqual({ kind: "absent" });
  changes.set("/change/CDELETE", "INSYNC");
  await expect(route.status("/change/CDELETE")).resolves.toMatchObject({ status: "INSYNC" });
  expect(x.send).toHaveBeenCalledTimes(8);
});
it("defaults both runtime and new-creation gates off", async () => {
  const x = setup();
  const route = createNativeResumeDnsRoute({ intent, testClient: { send: x.send } });
  for (const operation of [
    () => route.create(),
    () => route.remove(),
    () => route.inspect(),
    () => route.status(changeId),
  ])
    await expect(operation()).rejects.toThrow("NativeResumeDnsUnavailable");
  const readOnly = createNativeResumeDnsRoute({
    intent,
    testClient: { send: x.send },
    enabled: () => true,
  });
  await expect(readOnly.create()).rejects.toThrow("NativeResumeDnsUnavailable");
  expect(x.send).not.toHaveBeenCalled();
});
it("detaches the original route and never follows later address/zone changes", async () => {
  const x = setup(),
    route = createNativeResumeDnsRoute(x.options);
  x.options.intent.publicIp = "54.0.0.2";
  x.options.intent.hostedZoneId = "ZFOREIGN";
  await route.create();
  const command = x.send.mock.calls[0]?.[0] as ChangeResourceRecordSetsCommand;
  expect(command.input.HostedZoneId).toBe(intent.hostedZoneId);
  expect(command.input.ChangeBatch?.Changes?.[0]?.ResourceRecordSet).toEqual(record);
  expect(createNativeResumeDnsRoute({ ...x.options, intent: { ...intent } }).intentSha256).toBe(
    route.intentSha256,
  );
});
it.each(["publicIp", "allocationId", "hostedZoneId", "baseHost", "extra", "getter"])(
  "refuses invalid %s intent before effects",
  (kind) => {
    const x = setup();
    let reads = 0;
    if (kind === "publicIp") x.options.intent.publicIp = "127.0.0.1";
    if (kind === "allocationId") x.options.intent.allocationId = "arbitrary-label";
    if (kind === "hostedZoneId") x.options.intent.hostedZoneId = "/hostedzone/ZSYNTHETIC123";
    if (kind === "baseHost") x.options.intent.baseHost = "https://resumes.example.com";
    if (kind === "extra") Object.assign(x.options.intent, { TTL: 3600 });
    if (kind === "getter")
      Object.defineProperty(x.options.intent, "publicIp", {
        enumerable: true,
        get() {
          reads++;
          return intent.publicIp;
        },
      });
    expect(() => createNativeResumeDnsRoute(x.options)).toThrow("NativeResumeDnsUnavailable");
    expect(reads).toBe(0);
    expect(x.send).not.toHaveBeenCalled();
  },
);
it.each([
  "address",
  "ttl",
  "alias",
  "weighted",
  "extra address",
  "cname",
  "extra record",
  "malformed",
])("refuses %s listing without modifying DNS", async (kind) => {
  const x = setup();
  const found: Record<string, unknown> = structuredClone(record);
  if (kind === "address") found.ResourceRecords = [{ Value: "54.0.0.2" }];
  if (kind === "ttl") found.TTL = 300;
  if (kind === "alias")
    found.AliasTarget = {
      HostedZoneId: "ZFOREIGN",
      DNSName: "foreign.example.com",
      EvaluateTargetHealth: false,
    };
  if (kind === "weighted") found.SetIdentifier = "foreign";
  if (kind === "extra address")
    found.ResourceRecords = [{ Value: intent.publicIp }, { Value: "54.0.0.2" }];
  if (kind === "cname") found.Type = "CNAME";
  x.send.mockResolvedValue(
    kind === "malformed"
      ? {}
      : {
          ResourceRecordSets: kind === "extra record" ? [found, found] : [found],
          IsTruncated: false,
        },
  );
  await expect(createNativeResumeDnsRoute(x.options).inspect()).rejects.toThrow(
    "NativeResumeDnsUnavailable",
  );
  expect(x.send).toHaveBeenCalledOnce();
  expect(x.send.mock.calls[0]?.[0]).toBeInstanceOf(ListResourceRecordSetsCommand);
});
it("treats the next name as absent without returning neighbor metadata", async () => {
  const x = setup();
  x.send.mockResolvedValue({
    ResourceRecordSets: [{ ...record, Name: "unrelated.example.com." }],
    IsTruncated: true,
  });
  await expect(createNativeResumeDnsRoute(x.options).inspect()).resolves.toEqual({
    kind: "absent",
  });
});
it("accepts explicit false multivalue metadata and DNS case normalization", async () => {
  const x = setup();
  x.send.mockResolvedValue({
    ResourceRecordSets: [{ ...record, Name: name.toUpperCase(), MultiValueAnswer: false }],
    IsTruncated: false,
  });
  await expect(createNativeResumeDnsRoute(x.options).inspect()).resolves.toEqual({
    kind: "present",
  });
  x.send.mockResolvedValue({
    ResourceRecordSets: [{ ...record, MultiValueAnswer: true }],
    IsTruncated: false,
  });
  await expect(createNativeResumeDnsRoute(x.options).inspect()).rejects.toThrow(
    "NativeResumeDnsUnavailable",
  );
});
it.each(["CREATE", "DELETE"])(
  "does not retry %s after a lost acknowledgement or infer rollback",
  async (action) => {
    const x = setup();
    x.send.mockRejectedValue(Error("synthetic upstream private diagnostics"));
    const route = createNativeResumeDnsRoute(x.options);
    await expect(action === "CREATE" ? route.create() : route.remove()).rejects.toThrow(
      /^NativeResumeDnsUnavailable$/u,
    );
    expect(x.send).toHaveBeenCalledOnce();
    expect(x.send.mock.calls[0]?.[0]).toBeInstanceOf(ChangeResourceRecordSetsCommand);
  },
);
it.each(["foreign id", "missing receipt", "invalid status"])(
  "refuses %s propagation response",
  async (kind) => {
    const x = setup();
    x.send.mockResolvedValue(
      kind === "missing receipt"
        ? {}
        : {
            ChangeInfo: {
              Id: kind === "foreign id" ? "/change/CFOREIGN" : changeId,
              Status: kind === "invalid status" ? "SUCCESS" : "INSYNC",
            },
          },
    );
    await expect(createNativeResumeDnsRoute(x.options).status(changeId)).rejects.toThrow(
      "NativeResumeDnsUnavailable",
    );
  },
);
it("rejects arbitrary change URLs before AWS", async () => {
  const x = setup();
  await expect(
    createNativeResumeDnsRoute(x.options).status("https://foreign.example.com/change/CX"),
  ).rejects.toThrow("NativeResumeDnsUnavailable");
  expect(x.send).not.toHaveBeenCalled();
});
it("retains admission until a late mutation settles and never calls it completed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const x = setup();
  let fulfill!: (value: unknown) => void;
  x.send.mockImplementation(
    async () =>
      new Promise((resolve) => {
        fulfill = resolve;
      }),
  );
  const route = createNativeResumeDnsRoute({ ...x.options, timeoutMs: 10 });
  const pending = route.create();
  const assertion = expect(pending).rejects.toThrow("NativeResumeDnsUnavailable");
  await vi.advanceTimersByTimeAsync(20);
  await expect(route.remove()).rejects.toThrow("NativeResumeDnsUnavailable");
  expect(x.send).toHaveBeenCalledOnce();
  expect(x.send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
  fulfill({ ChangeInfo: { Id: changeId, Status: "INSYNC" } });
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
it("refuses withdrawn response and production test transport", async () => {
  const x = setup();
  x.send.mockImplementation(async () => {
    x.enabled.mockReturnValue(false);
    return { ChangeInfo: { Id: changeId, Status: "INSYNC" } };
  });
  await expect(createNativeResumeDnsRoute(x.options).create()).rejects.toThrow(
    "NativeResumeDnsUnavailable",
  );
  vi.stubEnv("NODE_ENV", "production");
  expect(() => createNativeResumeDnsRoute(x.options)).toThrow("NativeResumeDnsUnavailable");
});
