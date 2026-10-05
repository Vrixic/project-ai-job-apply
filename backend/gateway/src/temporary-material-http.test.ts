import { bindTemporaryResponse } from "@ai-job-apply/applications-service";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { installTemporaryMaterialResponseGuards } from "./temporary-material-http.js";

describe("temporary material response serialization guards", () => {
  it.each(["preview", "file", "before_send"])(
    "withholds %s content that expires after the service returns",
    async (kind) => {
      const server = Fastify();
      let live = true;
      const content = {
        contentBase64: "c3ludGhldGljLXByaXZhdGUtYnl0ZXM=",
        paragraphs: [{ text: "Synthetic private generated material" }],
      };
      if (kind === "before_send")
        server.addHook("onSend", async (_request, _reply, payload) => {
          live = false;
          return payload;
        });
      installTemporaryMaterialResponseGuards(server);
      server.get("/material", async () => {
        bindTemporaryResponse(
          content,
          () => live,
          () => {
            content.contentBase64 = "";
            content.paragraphs.length = 0;
          },
        );
        if (kind !== "before_send") live = false;
        return content;
      });
      try {
        const result = await server.inject("/material");
        expect(result.statusCode).toBe(409);
        expect(result.headers["cache-control"]).toBe("no-store");
        expect(result.headers["content-type"]).toContain("application/problem+json");
        expect(result.json()).toMatchObject({
          code: "application_packet_stale",
          title: "Generated material unavailable",
        });
        expect(result.body).not.toContain("Synthetic private");
        expect(result.body).not.toContain("c3ludGhldGlj");
        expect(content.contentBase64).toBe("");
        expect(content.paragraphs).toEqual([]);
        expect(Number(result.headers["content-length"])).toBe(Buffer.byteLength(result.body));
      } finally {
        await server.close();
      }
    },
  );
  it("sends a live response without serializing its guard", async () => {
    const server = Fastify();
    installTemporaryMaterialResponseGuards(server);
    server.get("/material", async () => {
      const value = { synthetic: true };
      bindTemporaryResponse(
        value,
        () => true,
        () => {},
      );
      return value;
    });
    try {
      const response = await server.inject("/material");
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ synthetic: true });
    } finally {
      await server.close();
    }
  });
  it("leaves unrelated responses unaffected", async () => {
    const server = Fastify();
    installTemporaryMaterialResponseGuards(server);
    server.get("/ordinary", async () => ({ synthetic: true }));
    try {
      const result = await server.inject("/ordinary");
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBeUndefined();
    } finally {
      await server.close();
    }
  });
  it("releases a successful response after sending without erasing the delivered bytes", async () => {
    const server = Fastify();
    installTemporaryMaterialResponseGuards(server);
    const value = { contentBase64: "c3ludGhldGlj" };
    const close = vi.fn();
    server.get("/material", async () => {
      bindTemporaryResponse(
        value,
        () => true,
        () => {
          value.contentBase64 = "";
        },
        close,
      );
      return value;
    });
    try {
      const response = await server.inject("/material");
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ contentBase64: "c3ludGhldGlj" });
      expect(value.contentBase64).toBe("");
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
  it("releases the held response if serialization fails", async () => {
    const server = Fastify();
    installTemporaryMaterialResponseGuards(server);
    const close = vi.fn();
    const value = { synthetic: BigInt(1) };
    server.get("/material", async () => {
      bindTemporaryResponse(
        value,
        () => true,
        () => {},
        close,
      );
      return value;
    });
    try {
      const response = await server.inject("/material");
      expect(response.statusCode).toBe(500);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});
