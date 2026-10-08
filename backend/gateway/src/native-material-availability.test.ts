import { EventEmitter } from "node:events";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain/temporary-material";
import { beforeEach, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request }));

import {
  createNativeMaterialAvailability,
  nativeMaterialAvailabilityFromEnvironment,
  withNativeMaterialCredential,
} from "./native-material-availability.js";

const owner = "019d04cf-1f80-7000-8000-000000000071";
const app = "019d04cf-1f80-7000-8000-000000000072";
const allocation = "019d04cf-1f80-7000-8000-000000000073";
const ref = (): TemporaryMaterialReference => ({
  schemaVersion: 1,
  kind: "cover_letter",
  generationId: allocation,
  ownerUserId: owner,
  applicationId: app,
  version: 1,
  contentSha256: "a".repeat(64),
  completedAtMs: Date.now(),
  expiresAtMs: Date.now() + 1800000,
});
function fixture() {
  const reference = ref();
  reference.expiresAtMs = reference.completedAtMs + 1800000;
  const state = {
    enabled: true,
    address: `https://${allocation}.material.test.invalid:8443`,
    status: 204,
    metadata: reference as unknown,
    contentLength: "0",
  };
  const resolve = vi.fn(async () => state.address);
  const port = createNativeMaterialAvailability({
    enabled: () => state.enabled,
    coverLetter: { baseHost: "material.test.invalid", resolve },
  });
  request.mockImplementation((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () =>
      queueMicrotask(() =>
        callback({
          statusCode: state.status,
          headers: {
            "x-native-material-reference": Buffer.from(JSON.stringify(state.metadata)).toString(
              "base64url",
            ),
            "content-length": state.contentLength,
          },
          destroy: vi.fn(),
        }),
      );
    options.signal.addEventListener("abort", () => req.emit("error", Error("aborted")), {
      once: true,
    });
    return req;
  });
  const read = () => port.current(owner, app, reference);
  const run = () => withNativeMaterialCredential(owner, app, "synthetic-token", read);
  return { state, reference, port, resolve, read, run };
}
beforeEach(() => {
  request.mockReset();
});
it("uses a bodyless exact-host TLS request with request-scoped credentials", async () => {
  const f = fixture();
  expect(await f.run()).toEqual(f.reference);
  const call = request.mock.calls[0];
  if (!call) throw Error("Missing availability request");
  const [url, options] = call;
  expect(url.href).toBe(
    `https://${allocation}.material.test.invalid:8443/v1/applications/${app}/cover-letter`,
  );
  expect(options).toMatchObject({
    method: "HEAD",
    minVersion: "TLSv1.3",
    agent: false,
    headers: { authorization: "Bearer synthetic-token" },
  });
  await expect(f.read()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([
  "disabled",
  "foreign_owner",
  "foreign_application",
  "untrusted_host",
  "redirect",
  "mismatch",
  "body",
])("refuses %s", async (failure) => {
  const f = fixture();
  if (failure === "disabled") f.state.enabled = false;
  if (failure === "foreign_owner") f.reference.ownerUserId = allocation;
  if (failure === "foreign_application") f.reference.applicationId = allocation;
  if (failure === "untrusted_host") f.state.address = `https://${allocation}.attacker.invalid:8443`;
  if (failure === "redirect") f.state.status = 302;
  if (failure === "mismatch") f.state.metadata = { ...f.reference, contentSha256: "b".repeat(64) };
  if (failure === "body") f.state.contentLength = "1";
  await expect(f.run()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  if (["disabled", "foreign_owner", "foreign_application", "untrusted_host"].includes(failure))
    expect(request).not.toHaveBeenCalled();
});
it("refuses withdrawal during owner lookup before sending credentials", async () => {
  const f = fixture();
  f.resolve.mockImplementation(async () => {
    f.state.enabled = false;
    return f.state.address;
  });
  await expect(f.run()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  expect(request).not.toHaveBeenCalled();
});
it("does not reuse credentials in concurrent or detached asynchronous work", async () => {
  const f = fixture();
  await Promise.all(
    ["first", "second"].map((token) =>
      withNativeMaterialCredential(owner, app, token, async () => {
        await new Promise((resolve) => setTimeout(resolve, token === "first" ? 5 : 1));
        await f.read();
      }),
    ),
  );
  expect(request.mock.calls.map((call) => call[1].headers.authorization).sort()).toEqual([
    "Bearer first",
    "Bearer second",
  ]);
  let detached: Promise<unknown> | undefined;
  await withNativeMaterialCredential(owner, app, "cleared", async () => {
    detached = new Promise((resolve, reject) =>
      setTimeout(() => f.read().then(resolve, reject), 10),
    );
  });
  await expect(detached).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
});

it("bounds an unavailable location owner before opening a connection", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.resolve.mockImplementation(() => new Promise(() => {}));
    const refused = expect(f.run()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
    await vi.advanceTimersByTimeAsync(8000);
    await refused;
    expect(request).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps environment composition dark and refuses withdrawn location authority", async () => {
  const f = fixture();
  const environment = {
    NATIVE_MATERIAL_BASE_HOST: "material.test.invalid",
    NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED: "true",
    NATIVE_MATERIAL_READ_LOCATIONS_ENABLED: "true",
    NATIVE_MATERIAL_AVAILABILITY_ENABLED: "false",
  };
  const port = nativeMaterialAvailabilityFromEnvironment(
    environment,
    () => true,
    { resolve: f.resolve },
    undefined,
  );
  const run = () =>
    withNativeMaterialCredential(owner, app, "synthetic-token", () =>
      port.current(owner, app, f.reference),
    );
  await expect(run()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  environment.NATIVE_MATERIAL_AVAILABILITY_ENABLED = "true";
  expect(await run()).toEqual(f.reference);
  environment.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED = "false";
  await expect(run()).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  expect(request).toHaveBeenCalledTimes(1);
});
