import type { PublicJobDetailResponse } from "@ai-job-apply/api-contracts";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPublicJobDetail } from "../../../lib/public-job-read";
import { loadPublicWebSettings } from "../../../lib/public-web-origin";

export const dynamic = "force-dynamic";

interface PublicJobPageProps {
  params: Promise<{ jobId: string }>;
}

function canonicalPath(jobId: string) {
  return `/jobs/${jobId}`;
}

function truncateMetadataText(value: string, maximumCodePoints: number) {
  return Array.from(value).slice(0, maximumCodePoints).join("");
}

export function buildPublicJobMetadata(
  detail: PublicJobDetailResponse,
  origin: URL,
  indexingEnabled: boolean,
): Metadata {
  const canonical = new URL(canonicalPath(detail.canonicalJobId), origin);
  const title = truncateMetadataText(`${detail.job.title} at ${detail.job.companyName}`, 160);
  const description = truncateMetadataText(
    `${detail.job.title} at ${detail.job.companyName}. ${detail.job.locations.join(", ")}`,
    200,
  );
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
    },
    robots: indexingEnabled
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true, nosnippet: true },
  };
}

export async function generateMetadata({ params }: PublicJobPageProps): Promise<Metadata> {
  const { jobId } = await params;
  const result = await getPublicJobDetail(jobId);
  if (result.kind === "absent") {
    return { title: "Job not found", robots: { index: false, follow: false } };
  }
  const settings = loadPublicWebSettings();
  return buildPublicJobMetadata(result.detail, settings.origin, settings.indexingEnabled);
}

export default async function PublicJobPage({ params }: PublicJobPageProps) {
  const { jobId } = await params;
  const result = await getPublicJobDetail(jobId);
  if (result.kind === "absent") notFound();
  if (result.detail.isAlias) redirect(canonicalPath(result.detail.canonicalJobId));

  const { job } = result.detail;
  return (
    <main className="public-job-page">
      <article className="public-job-card">
        <header>
          <p className="eyebrow">Current public job detail</p>
          <h1>{job.title}</h1>
          <p className="public-job-company">{job.companyName}</p>
        </header>
        <dl className="public-job-facts">
          <div>
            <dt>Location</dt>
            <dd>{job.locations.join(", ")}</dd>
          </div>
          {job.department ? (
            <div>
              <dt>Department</dt>
              <dd>{job.department}</dd>
            </div>
          ) : null}
          <div>
            <dt>Last verified</dt>
            <dd>{new Date(job.lastVerifiedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</dd>
          </div>
        </dl>
        <section aria-labelledby="description-heading">
          <h2 id="description-heading">Job description</h2>
          <p className="public-job-description">{job.description}</p>
        </section>
        <p className="public-job-notice">
          This page is a read-only, last-verified snapshot. Confirm current details with the
          employer before applying.
        </p>
      </article>
    </main>
  );
}
