import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig, {
  resolveCrawlerHeaders,
  resolveOutputMode,
  securityHeaders,
} from "./next.config.js";

describe("candidate web deployment headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets Vercel own its build output while preserving standalone self-hosting", () => {
    expect(resolveOutputMode("1")).toEqual({});
    expect(resolveOutputMode(undefined)).toEqual({ output: "standalone" });
  });

  it("applies the fail-closed browser boundary to every route", async () => {
    vi.stubEnv("PUBLIC_JOB_INDEXING_ENABLED", undefined);
    expect(await nextConfig.headers?.()).toEqual([
      {
        source: "/:path*",
        headers: [...securityHeaders, { key: "X-Robots-Tag", value: "noindex" }],
      },
    ]);
    expect(Object.fromEntries(securityHeaders.map(({ key, value }) => [key, value]))).toMatchObject(
      {
        "Content-Security-Policy": expect.stringContaining("frame-ancestors 'none'"),
        "Permissions-Policy": expect.stringContaining("camera=()"),
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    );
  });

  it("keeps crawler access denied until indexing is exactly enabled", () => {
    expect(resolveCrawlerHeaders(undefined)).toEqual([{ key: "X-Robots-Tag", value: "noindex" }]);
    expect(resolveCrawlerHeaders("false")).toEqual([{ key: "X-Robots-Tag", value: "noindex" }]);
    expect(resolveCrawlerHeaders("true")).toEqual([]);
    for (const value of ["TRUE", "False", "0", "1", " true", "false ", ""]) {
      expect(() => resolveCrawlerHeaders(value)).toThrow(
        "PUBLIC_JOB_INDEXING_ENABLED must be exactly true or false",
      );
    }
  });

  it.each([
    [undefined, [{ key: "X-Robots-Tag", value: "noindex" }]],
    ["false", [{ key: "X-Robots-Tag", value: "noindex" }]],
    ["true", []],
  ])("materializes the exact crawler setting %s in build headers", async (value, crawler) => {
    vi.stubEnv("PUBLIC_JOB_INDEXING_ENABLED", value);
    expect(await nextConfig.headers?.()).toEqual([
      { source: "/:path*", headers: [...securityHeaders, ...crawler] },
    ]);
  });

  it("rejects an invalid crawler setting at the build-header boundary", async () => {
    vi.stubEnv("PUBLIC_JOB_INDEXING_ENABLED", "TRUE");
    await expect(nextConfig.headers?.()).rejects.toThrow(
      "PUBLIC_JOB_INDEXING_ENABLED must be exactly true or false",
    );
  });

  it("keeps the strict opener policy on every route, with no popup exception", async () => {
    vi.stubEnv("NEXT_PUBLIC_NATIVE_MATERIAL_UI", "enabled");
    const headers = await nextConfig.headers?.();
    expect(headers).toHaveLength(1);
    expect(headers?.[0]?.source).toBe("/:path*");
    expect(headers?.[0]?.headers).toContainEqual({
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin",
    });
    expect(JSON.stringify(headers)).not.toContain("allow-popups");
  });
});
