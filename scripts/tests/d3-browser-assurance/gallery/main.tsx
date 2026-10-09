import type { Application } from "@ai-job-apply/api-contracts";
import { createRoot } from "react-dom/client";
import "../../../../frontend/web/app/styles.css";
import { AppliedJobsPanel } from "../../../../frontend/web/app/applied-jobs-panel";
import { JobSearchForm } from "../../../../frontend/web/app/job-search-form";
import { ResumePreviewSection } from "../../../../frontend/web/app/resume-preview-section";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const PACKET = "00000000-0000-7000-8000-000000000003";
const ATTEMPT = "00000000-0000-7000-8000-000000000004";
const HASH = "a".repeat(64);
const AT = new Date().toISOString();
const job = {
  id: JOB,
  company: { id: "00000000-0000-7000-8000-000000000010", name: "Synthetic Company" },
  title: "Synthetic Engineer",
  locations: ["Remote"],
  description: "Build truthful synthetic tools.",
  status: "active",
  firstObservedAt: AT,
  lastVerifiedAt: AT,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  sources: [
    {
      provider: "other",
      provenance: "authorized_fixture",
      canonicalUrl: "https://boards.example.test/jobs/1",
      firstObservedAt: AT,
      lastVerifiedAt: AT,
    },
  ],
};

const approved = {
  id: APP,
  canonicalJobId: JOB,
  status: "approved",
  revision: 3,
  currentAction: "ready_to_submit",
  attempts: [],
  createdAt: AT,
  updatedAt: AT,
  approval: {
    packetHash: HASH,
    approvedAt: AT,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    acknowledgedFieldKeys: [],
  },
  currentPacket: {
    id: PACKET,
    version: 1,
    packetHash: HASH,
    jobRevision: HASH,
    artifactHashes: {},
    fields: [
      {
        fieldKey: "contact.email",
        value: "candidate@example.test",
        origin: "confirmed_fact",
        sourceFactIds: [],
        confidence: 1,
        disposition: "auto",
        reasons: [],
        requiresReview: true,
      },
    ],
    createdAt: AT,
  },
} as unknown as Application;

const preparing = {
  id: APP,
  canonicalJobId: JOB,
  status: "preparing",
  revision: 1,
  currentAction: "prepare_packet",
  attempts: [],
  createdAt: AT,
  updatedAt: AT,
} as Application;
const review = {
  ...approved,
  status: "review_required",
  revision: 2,
  currentAction: "review_and_approve",
  approval: undefined,
} as unknown as Application;
let current: Application | undefined;

const takenOver = {
  ...approved,
  status: "takeover",
  revision: 4,
  currentAction: "complete_manually",
  attempts: [
    {
      id: ATTEMPT,
      sequence: 1,
      status: "taken_over",
      adapterId: "manual",
      adapterVersion: "none",
      startedAt: AT,
      resolvedAt: AT,
    },
  ],
} as unknown as Application;

const applied = {
  ...takenOver,
  status: "applied",
  revision: 5,
  currentAction: "none",
  attempts: [
    {
      ...takenOver.attempts[0],
      status: "confirmed",
      confirmation: { kind: "user_attested", observedAt: AT },
    },
  ],
} as unknown as Application;

type RecordedCall = { url: string; method: string; body?: unknown; idempotencyKey?: string };
const calls: RecordedCall[] = [];

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });

const syntheticFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  calls.push({
    url,
    method: init.method ?? "GET",
    ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    ...((init.headers as Record<string, string> | undefined)?.["idempotency-key"]
      ? {
          idempotencyKey: (init.headers as Record<string, string>)["idempotency-key"],
        }
      : {}),
  });
  if (url.endsWith("/jobs/search")) return respond({ items: [job] });
  if (url === `/api/platform/jobs/${JOB}`) return respond(job);
  if (url.endsWith("/applications/search")) return respond({ items: current ? [current] : [] });
  if (url === "/api/platform/applications") {
    current = preparing;
    return respond(current, 201);
  }
  if (url.endsWith("/packets")) {
    current = review;
    return respond(current, 201);
  }
  if (url.endsWith("/approval")) {
    current = approved;
    return respond(current);
  }
  if (url.endsWith("/manual-submissions")) {
    current = takenOver;
    return respond({ outcome: "started", attemptId: ATTEMPT, application: takenOver });
  }
  if (url.endsWith("/reconciliation")) {
    current = applied;
    return respond(applied);
  }
  if (url.endsWith("/resume")) {
    return respond({ status: "no_resume", matchesPacket: false });
  }
  return respond({ code: "application_not_found" }, 404);
}) as typeof globalThis.fetch;

declare global {
  interface Window {
    readD3AssuranceCalls(): RecordedCall[];
    showD3ExpiryPreview(): void;
  }
}

window.readD3AssuranceCalls = () => structuredClone(calls);
window.fetch = syntheticFetch;

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The browser-assurance root is missing");
const root = createRoot(container);
window.showD3ExpiryPreview = () => {
  const expiresAtMs = Date.now() + 1500;
  root.render(
    <ResumePreviewSection
      applicationId={APP}
      revision={2}
      expectedHash={HASH}
      fetchImplementation={async () =>
        respond({
          status: "ready",
          matchesPacket: true,
          contentSha256: HASH,
          tailoringVersion: "synthetic.v1",
          temporaryMaterial: {
            schemaVersion: 1,
            kind: "tailored_resume",
            generationId: PACKET,
            version: 1,
            contentSha256: HASH,
            completedAtMs: expiresAtMs - 1_800_000,
            expiresAtMs,
          },
          sections: [
            {
              kind: "experience",
              entries: [{ lines: ["Generated synthetic one-off preview"], bullets: [] }],
            },
          ],
        })
      }
    />,
  );
};
root.render(
  <JobSearchForm
    authenticated
    savedPanel={<p>No saved jobs in this synthetic journey.</p>}
    appliedPanel={<AppliedJobsPanel authenticated />}
  />,
);
