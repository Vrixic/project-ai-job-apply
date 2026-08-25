import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "./next.config.js";

describe("moderation deployment headers", () => {
  it("applies browser hardening and crawler denial to every route", async () => {
    expect(await nextConfig.headers?.()).toEqual([
      { source: "/:path*", headers: [...securityHeaders] },
    ]);
    expect(Object.fromEntries(securityHeaders.map(({ key, value }) => [key, value]))).toMatchObject(
      {
        "Content-Security-Policy": expect.stringContaining("frame-ancestors 'none'"),
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    );
  });
});
