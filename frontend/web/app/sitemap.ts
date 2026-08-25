import type { MetadataRoute } from "next";
import { fetchCompletePublicJobSitemap } from "../lib/public-job-sitemap";
import { loadPublicWebSettings } from "../lib/public-web-origin";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = loadPublicWebSettings();
  if (!settings.indexingEnabled) return [];

  const items = await fetchCompletePublicJobSitemap();
  return items.map((item) => ({
    url: new URL(`/jobs/${item.jobId}`, settings.origin).toString(),
    lastModified: item.lastModifiedAt,
  }));
}
