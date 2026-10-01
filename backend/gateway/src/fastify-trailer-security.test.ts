import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

describe("Fastify trailer security regression (CVE-2026-92081)", () => {
  it("serves repeated HTTP/2 trailer responses without terminating the process", () => {
    // Isolate the pre-fix uncaught exception from the test runner. Only generated data and
    // ephemeral loopback ports are used; production Gateway transport settings are unchanged.
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import Fastify from "fastify";
          import { connect } from "node:http2";
          const server = Fastify({ http2: true, logger: false });
          server.get("/synthetic", async (_request, reply) => {
            reply.trailer("x-synthetic-check", async () => "verified");
            return { synthetic: true };
          });
          const origin = await server.listen({ port: 0, host: "127.0.0.1" });
          const connection = connect(origin);
          try {
            const responses = [];
            for (let index = 0; index < 2; index++) {
              responses.push(await new Promise((resolve, reject) => {
                const stream = connection.request({ ":path": "/synthetic" });
                const response = { body: "", status: null, transferEncoding: null, check: null };
                stream.setEncoding("utf8");
                stream.once("response", (headers) => {
                  response.status = headers[":status"];
                  response.transferEncoding = headers["transfer-encoding"] ?? null;
                });
                stream.once("trailers", (headers) => { response.check = headers["x-synthetic-check"]; });
                stream.on("data", (part) => { response.body += part; });
                stream.once("error", reject);
                stream.once("end", () => resolve(response));
                stream.end();
              }));
            }
            process.stdout.write(JSON.stringify(responses));
          } finally {
            connection.destroy();
            await server.close();
          }
        `,
      ],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual(
      Array.from({ length: 2 }, () => ({
        body: JSON.stringify({ synthetic: true }),
        status: 200,
        transferEncoding: null,
        check: "verified",
      })),
    );
  });

  it("preserves HTTP/1 trailer behavior", async () => {
    const server = Fastify({ logger: false });
    try {
      server.get("/synthetic", async (_request, reply) => {
        reply.trailer("x-synthetic-check", async () => "verified");
        return { synthetic: true };
      });
      const response = await server.inject({ method: "GET", url: "/synthetic" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ synthetic: true });
      expect(response.headers["transfer-encoding"]).toBe("chunked");
      expect(response.trailers["x-synthetic-check"]).toBe("verified");
    } finally {
      await server.close();
    }
  });
});
