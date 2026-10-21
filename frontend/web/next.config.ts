import type { NextConfig } from "next";

export const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

export function resolveOutputMode(vercelIndicator: string | undefined) {
  return vercelIndicator === "1" ? {} : { output: "standalone" as const };
}

export function resolveCrawlerHeaders(indexingEnabled: string | undefined) {
  if (indexingEnabled === undefined || indexingEnabled === "false") {
    return [{ key: "X-Robots-Tag", value: "noindex" }] as const;
  }
  if (indexingEnabled === "true") return [];
  throw new Error("PUBLIC_JOB_INDEXING_ENABLED must be exactly true or false");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...resolveOutputMode(process.env.VERCEL),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          ...resolveCrawlerHeaders(process.env.PUBLIC_JOB_INDEXING_ENABLED),
        ],
      },
    ];
  },
};

export default nextConfig;
