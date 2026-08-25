import { describe, expect, it, vi } from "vitest";
import {
  createLazyProjectionHandler,
  createProjectionHandler,
} from "./public-job-projection-lambda.js";

const jobId = "019c0000-0000-7000-8000-000000000001";

describe("public job projection Lambda", () => {
  it("exports a private lazy handler without connecting during import", async () => {
    const module = await import("./public-job-projection-lambda.js");
    expect(module.projectionHandler).toBeTypeOf("function");
    expect(module.projectionHandler).toHaveLength(2);
    expect(module.createConfiguredProjectionHandler).toBeTypeOf("function");
  });

  it("initializes once and forwards only the internal event", async () => {
    const configured = vi.fn(async () => ({ kind: "absent" as const }));
    const initialize = vi.fn(async () => configured);
    const handler = createLazyProjectionHandler(initialize);
    await expect(handler({ schemaVersion: 1, jobId }, {} as never)).resolves.toEqual({
      kind: "absent",
    });
    await handler({ schemaVersion: 1, jobId }, {} as never);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(configured).toHaveBeenCalledTimes(2);
  });

  it("retries a private initialization failure without projecting it as absence", async () => {
    const configured = vi.fn(async () => ({ kind: "absent" as const }));
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce(configured);
    const handler = createLazyProjectionHandler(initialize);
    await expect(handler({ schemaVersion: 1, jobId }, {} as never)).rejects.toThrow("private");
    await expect(handler({ schemaVersion: 1, jobId }, {} as never)).resolves.toMatchObject({
      kind: "absent",
    });
  });

  it("accepts only an exact identifier-only internal event", async () => {
    const projector = { get: vi.fn(async () => ({ kind: "absent" as const })) };
    const handler = createProjectionHandler(projector);
    await expect(handler({ schemaVersion: 1, jobId }, {} as never)).resolves.toEqual({
      kind: "absent",
    });
    await expect(
      handler({ schemaVersion: 1, jobId, query: "forbidden" }, {} as never),
    ).rejects.toThrow("request is invalid");
    await expect(
      handler({ schemaVersion: 1, jobId: jobId.toUpperCase() }, {} as never),
    ).rejects.toThrow("request is invalid");
    expect(projector.get).toHaveBeenCalledTimes(1);
  });

  it("accepts only the tagged bounded sitemap projection event", async () => {
    const detail = { get: vi.fn(async () => ({ kind: "absent" as const })) };
    const sitemap = {
      list: vi.fn(async () => ({ kind: "page" as const, items: [], hasMore: false })),
    };
    const handler = createProjectionHandler(detail, sitemap);
    await expect(
      handler({ schemaVersion: 1, operation: "sitemap", cursor: null }, {} as never),
    ).resolves.toEqual({ kind: "page", items: [], hasMore: false });
    await expect(
      handler({ schemaVersion: 1, operation: "sitemap", cursor: null, limit: 10_000 }, {} as never),
    ).rejects.toThrow("request is invalid");
    await expect(
      handler(
        {
          schemaVersion: 1,
          operation: "sitemap",
          cursor: { jobId, lastModifiedAt: "not-an-instant" },
        },
        {} as never,
      ),
    ).rejects.toThrow("request is invalid");
    expect(sitemap.list).toHaveBeenCalledTimes(1);
  });
});
