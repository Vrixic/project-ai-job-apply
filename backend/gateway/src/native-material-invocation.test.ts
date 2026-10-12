import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", async (original) => ({ ...(await original()), request }));

import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
} from "./lambda.js";
import {
  createNativeMaterialAvailability,
  withNativeMaterialCredential,
  withNativeMaterialInvocationCredential,
} from "./native-material-availability.js";

const owner = "019d04cf-1f80-7000-8000-000000000071";
const app = "019d04cf-1f80-7000-8000-000000000072";
const other = "019d04cf-1f80-7000-8000-000000000073";
const issuer = "https://identity.example.test/";
const audience = "ai-job-apply-api";

function fixture() {
  request.mockReset();
  const at = Date.now();
  const reference = {
    schemaVersion: 1 as const,
    kind: "tailored_resume" as const,
    generationId: other,
    ownerUserId: owner,
    applicationId: app,
    version: 1,
    contentSha256: "a".repeat(64),
    completedAtMs: at,
    expiresAtMs: at + 1800000,
  };
  const observed: string[] = [];
  request.mockImplementation((_url, options, callback) => {
    observed.push(options.headers.authorization);
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () =>
      queueMicrotask(() =>
        callback({
          statusCode: 204,
          headers: {
            "x-native-material-reference": Buffer.from(JSON.stringify(reference)).toString(
              "base64url",
            ),
          },
          destroy: vi.fn(),
        }),
      );
    return req;
  });
  const port = createNativeMaterialAvailability({
    enabled: () => true,
    resume: {
      baseHost: "material.example.test",
      resolve: async () => `https://${other}.material.example.test:8443`,
    },
  });
  const read = () => port.current(owner, app, reference);
  return { read, observed };
}

it.each(["approval", "submissions", "manual-submissions", `attempts/${other}/dispatch`])(
  "forwards the original caller only to native HEAD through Lambda %s",
  async (command) => {
    const f = fixture();
    const bridge = createInvocationPrincipalBridge();
    const path = `/v1/applications/${app}/${command}`;
    const token = "synthetic.original.jwt";
    const server = Fastify();
    server.post(path, async (incoming) => {
      const internal = incoming.headers.authorization?.slice(7) ?? "";
      expect(incoming.headers.authorization).not.toBe(`Bearer ${token}`);
      expect((await bridge.verifier.verify(internal)).subject).toBe("synthetic|owner");
      await withNativeMaterialCredential(owner, app, internal, f.read);
      return {};
    });
    await server.ready();
    const handler = createApiGatewayHandler({
      issuer,
      audience,
      principalBridge: bridge,
      app: Promise.resolve({
        inject: ({ headers, url, payload }) =>
          server.inject({
            method: "POST",
            headers,
            url,
            ...(payload === undefined ? {} : { payload }),
          }),
      }),
    });
    const result = await handler({
      version: "2.0",
      routeKey: `POST ${path}`,
      rawPath: path,
      rawQueryString: "",
      headers: {
        authorization: `Bearer ${token}`,
        ...(command.startsWith("attempts/") ? {} : { "content-type": "application/json" }),
      },
      ...(command.startsWith("attempts/") ? {} : { body: "{}" }),
      isBase64Encoded: false,
      requestContext: {
        accountId: "123456789012",
        apiId: "synthetic-api",
        domainName: "api.example.test",
        domainPrefix: "api",
        stage: "$default",
        time: "12/Oct/2026:17:00:00 +0000",
        timeEpoch: 1791824400000,
        routeKey: `POST ${path}`,
        requestId: "synthetic-request",
        http: {
          method: "POST",
          path,
          protocol: "HTTP/1.1",
          sourceIp: "203.0.113.1",
          userAgent: "synthetic-test",
        },
        authorizer: {
          jwt: {
            claims: { iss: issuer, sub: "synthetic|owner", aud: audience },
            scopes: ["applications:read", "applications:write"],
          },
        },
      },
    } as AuthorizedHttpApiEvent);
    expect(result.statusCode).toBe(200);
    expect(f.observed).toEqual([`Bearer ${token}`]);
    await server.close();
  },
);

it("isolates concurrent credentials and refuses foreign capability/application and detached reuse", async () => {
  const f = fixture();
  let detached: Promise<unknown> | undefined;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await Promise.all(
    ["one", "two"].map((id) =>
      withNativeMaterialInvocationCredential(id, app, `jwt-${id}`, async () => {
        await withNativeMaterialCredential(owner, app, id, f.read);
        await expect(withNativeMaterialCredential(owner, app, "foreign", f.read)).rejects.toThrow(
          "NativeMaterialAvailabilityUnavailable",
        );
        await expect(withNativeMaterialCredential(owner, other, id, f.read)).rejects.toThrow(
          "NativeMaterialAvailabilityUnavailable",
        );
        if (id === "one")
          detached = wait.then(() => withNativeMaterialCredential(owner, app, id, f.read));
      }),
    ),
  );
  release();
  await expect(detached).rejects.toThrow("NativeMaterialAvailabilityUnavailable");
  expect(f.observed.sort()).toEqual(["Bearer jwt-one", "Bearer jwt-two"]);
});
