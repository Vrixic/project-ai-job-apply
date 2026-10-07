import { afterEach, describe, expect, it, vi } from "vitest";
import { startNativeResumeTask } from "./native-resume-task-bootstrap.js";
import { readNativeResumeTaskBinding } from "./native-resume-task-metadata.js";
import { startNativeMaterialTask } from "./native-task-bootstrap.js";
import { readNativeTaskBinding } from "./native-task-metadata.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const deployment = {
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
    containerName: "material",
  };
  const taskArn = `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`;
  const environment = {
    ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/synthetic-endpoint",
    NATIVE_MATERIAL_ALLOCATION_ID: id(1),
    NATIVE_MATERIAL_OWNER_USER_ID: id(2),
    NATIVE_MATERIAL_APPLICATION_ID: id(3),
    NATIVE_MATERIAL_GENERATION_ID: id(4),
    NATIVE_MATERIAL_EPOCH_ID: id(5),
    NATIVE_MATERIAL_WORK_ID: id(6),
    NATIVE_MATERIAL_REQUEST_SHA256: "b".repeat(64),
  };
  const self = {
    DockerId: `${"a".repeat(32)}-1234567890`,
    Name: "material",
    Type: "NORMAL",
    Image: "synthetic-pinned-image",
    ImageID: `sha256:${"c".repeat(64)}`,
    DesiredStatus: "RUNNING",
    KnownStatus: "RUNNING",
    Labels: {
      "com.amazonaws.ecs.task-arn": taskArn,
      "com.amazonaws.ecs.cluster": deployment.clusterArn,
      "com.amazonaws.ecs.container-name": "material",
      "com.amazonaws.ecs.task-definition-family": "native",
      "com.amazonaws.ecs.task-definition-version": "3",
    },
  };
  const task = {
    Cluster: deployment.clusterArn,
    TaskARN: taskArn,
    Family: "native",
    Revision: "3",
    LaunchType: "FARGATE",
    DesiredStatus: "RUNNING",
    KnownStatus: "RUNNING",
    Containers: [structuredClone(self)],
  };
  const enabled = vi.fn(() => true);
  const testFetch = vi.fn(
    async (url: string | URL | Request) =>
      new Response(JSON.stringify(String(url).endsWith("/task") ? task : self), {
        headers: { "content-type": "application/json" },
      }),
  );
  return { deployment, environment, self, task, enabled, testFetch, taskArn };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("original ECS native task bootstrap metadata", () => {
  it("reads current container and task, ignores additive AWS fields and returns detached scalar binding", async () => {
    const f = fixture();
    Object.assign(f.task, { ClockDrift: { ClockSynchronizationStatus: "SYNCHRONIZED" } });
    const binding = await readNativeTaskBinding(f);
    expect(binding.scope.generationId).toBe(id(4));
    expect(binding.allocation.taskArn).toBe(f.taskArn);
    expect(binding.original).toEqual({
      id: id(6),
      documentId: id(4),
      purpose: "provider_dispatch",
      requestSha256: "b".repeat(64),
    });
    expect(f.testFetch.mock.calls.map(([url]) => url)).toEqual([
      f.environment.ECS_CONTAINER_METADATA_URI_V4,
      `${f.environment.ECS_CONTAINER_METADATA_URI_V4}/task`,
    ]);
    expect(Object.isFrozen(binding.scope)).toBe(true);
    f.environment.NATIVE_MATERIAL_GENERATION_ID = id(99);
    expect(binding.scope.generationId).toBe(id(4));
  });
  it.each([
    "https://169.254.170.2/v4/abc",
    "http://127.0.0.1/v4/abc",
    "http://169.254.170.2.evil.test/v4/abc",
    "http://user@169.254.170.2/v4/abc",
    "http://169.254.170.2/v4/abc?task=foreign",
    "http://169.254.170.2/v4/abc/../task",
    "http://169.254.170.2/v4/abc#fragment",
  ])("refuses unsafe metadata URI %s without I/O", async (uri) => {
    const f = fixture();
    f.environment.ECS_CONTAINER_METADATA_URI_V4 = uri;
    await expect(readNativeTaskBinding(f)).rejects.toThrow("NativeTaskBootstrapUnavailable");
    expect(f.testFetch).not.toHaveBeenCalled();
  });
  it.each([
    "task",
    "cluster",
    "family",
    "revision",
    "container",
    "digest",
    "docker",
    "sidecar",
    "stopped",
    "label",
    "not_fargate",
    "missing",
  ])("refuses %s metadata mismatch", async (fault) => {
    const f = fixture();
    const current = f.task.Containers[0];
    if (!current) throw Error("FixtureContainerMissing");
    if (fault === "task") f.task.TaskARN = f.taskArn.replace(/a{32}$/u, "b".repeat(32));
    if (fault === "cluster") f.task.Cluster = "foreign";
    if (fault === "family") f.task.Family = "foreign";
    if (fault === "revision") f.task.Revision = "4";
    if (fault === "container") current.Name = "foreign";
    if (fault === "digest") current.ImageID = `sha256:${"d".repeat(64)}`;
    if (fault === "docker") current.DockerId = `${"b".repeat(32)}-1234567890`;
    if (fault === "sidecar") f.task.Containers.push({ ...f.self, Name: "sidecar" });
    if (fault === "stopped") f.task.KnownStatus = "STOPPED";
    if (fault === "label") f.self.Labels["com.amazonaws.ecs.task-definition-version"] = "4";
    if (fault === "not_fargate") f.task.LaunchType = "EC2";
    if (fault === "missing") f.task.Containers.length = 0;
    await expect(readNativeTaskBinding(f)).rejects.toThrow("NativeTaskBootstrapUnavailable");
  });
  it("defaults off before accessing deployment, environment or transport", async () => {
    const f = fixture();
    const { enabled: _enabled, ...defaultOff } = f;
    await expect(readNativeTaskBinding(defaultOff)).rejects.toThrow(
      "NativeTaskBootstrapUnavailable",
    );
    expect(f.testFetch).not.toHaveBeenCalled();
    const loadPorts = vi.fn();
    await expect(
      startNativeMaterialTask({ deployment: f.deployment, ownerFunctionArn: "invalid", loadPorts }),
    ).rejects.toThrow("NativeTaskBootstrapUnavailable");
    expect(loadPorts).not.toHaveBeenCalled();
  });
  it.each(["status", "type", "oversize", "json", "utf8", "revoked"])(
    "refuses %s response",
    async (fault) => {
      const f = fixture();
      f.testFetch.mockImplementationOnce(async () => {
        if (fault === "revoked") f.enabled.mockReturnValue(false);
        return new Response(
          fault === "oversize"
            ? "x".repeat(65_537)
            : fault === "utf8"
              ? new Uint8Array([0xff])
              : fault === "json"
                ? "{"
                : JSON.stringify(f.self),
          {
            status: fault === "status" ? 403 : 200,
            headers: { "content-type": fault === "type" ? "text/plain" : "application/json" },
          },
        );
      });
      await expect(readNativeTaskBinding(f)).rejects.toThrow("NativeTaskBootstrapUnavailable");
      expect(f.testFetch).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses test transports in production", async () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    await expect(readNativeTaskBinding(f)).rejects.toThrow("NativeTaskBootstrapUnavailable");
    expect(f.testFetch).not.toHaveBeenCalled();
  });
  it("retains its test-seam guard through an awaited response", async () => {
    const f = fixture();
    f.testFetch.mockImplementationOnce(async () => {
      Reflect.deleteProperty(f, "testFetch");
      vi.stubEnv("NODE_ENV", "production");
      return new Response(JSON.stringify(f.self), {
        headers: { "content-type": "application/json" },
      });
    });
    await expect(readNativeTaskBinding(f)).rejects.toThrow("NativeTaskBootstrapUnavailable");
  });
});

it("binds resume self metadata and configuration without a provider work grant", async () => {
  const f = fixture();
  const {
    NATIVE_MATERIAL_WORK_ID: _work,
    NATIVE_MATERIAL_REQUEST_SHA256: _request,
    ...environment
  } = f.environment;
  const binding = await readNativeResumeTaskBinding({
    ...f,
    environment: { ...environment, NATIVE_RESUME_CONFIGURATION_SHA256: "f".repeat(64) },
  });
  expect(binding.kind).toBe("tailored_resume");
  expect(binding.configurationSha256).toBe("f".repeat(64));
  expect(binding.allocation.taskArn).toBe(f.taskArn);
  expect(Object.hasOwn(binding, "original")).toBe(false);
  expect(Object.isFrozen(binding)).toBe(true);
});
it("refuses resume metadata with cover-letter grant or missing configuration before I/O", async () => {
  const f = fixture();
  await expect(
    readNativeResumeTaskBinding({
      ...f,
      environment: { ...f.environment, NATIVE_RESUME_CONFIGURATION_SHA256: "f".repeat(64) },
    }),
  ).rejects.toThrow("NativeTaskBootstrapUnavailable");
  const {
    NATIVE_MATERIAL_WORK_ID: _work,
    NATIVE_MATERIAL_REQUEST_SHA256: _request,
    ...environment
  } = f.environment;
  await expect(readNativeResumeTaskBinding({ ...f, environment })).rejects.toThrow(
    "NativeTaskBootstrapUnavailable",
  );
  expect(f.testFetch).not.toHaveBeenCalled();
});
it("defaults resume task startup off before trusted ports or network", async () => {
  const f = fixture(),
    loadPorts = vi.fn();
  await expect(
    startNativeResumeTask({
      deployment: f.deployment,
      ownerFunctionArn: "invalid",
      sourceFunctionArn: "invalid",
      loadPorts,
    }),
  ).rejects.toThrow("NativeTaskBootstrapUnavailable");
  expect(loadPorts).not.toHaveBeenCalled();
});
