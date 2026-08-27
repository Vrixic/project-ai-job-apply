import { describe, expect, it } from "vitest";
import nextConfig, {
  resolveCrawlerHeaders,
  resolveOutputMode,
  securityHeaders,
} from "./next.config.js";

describe("candidate web deployment headers", () => {
  it("lets Vercel own its build output while preserving standalone self-hosting", () => {
    expect(resolveOutputMode("1")).toEqual({});
    expect(resolveOutputMode(undefined)).toEqual({ output: "standalone" });
  });

  it("applies the fail-closed browser boundary to every route", async () => {
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
});
