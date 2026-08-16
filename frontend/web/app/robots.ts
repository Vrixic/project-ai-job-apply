import type { MetadataRoute } from "next";
import { loadPublicWebSettings } from "../lib/public-web-origin";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const { indexingEnabled } = loadPublicWebSettings();
  return {
    rules: indexingEnabled
      ? { userAgent: "*", disallow: "/", allow: "/jobs/" }
      : { userAgent: "*", disallow: "/" },
  };
}
