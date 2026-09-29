import type { Application } from "@ai-job-apply/api-contracts";
import { createRoot } from "react-dom/client";
import "../../../../frontend/web/app/styles.css";
import { ApplicationsWorkspace } from "../../../../frontend/web/app/applications-workspace";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const PACKET = "00000000-0000-7000-8000-000000000003";
const ATTEMPT = "00000000-0000-7000-8000-000000000004";
const HASH = "a".repeat(64);
const AT = "2026-09-28T12:00:00.000Z";

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
    expiresAt: "2026-09-29T12:00:00.000Z",
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
        requiresReview: false,
      },
    ],
    createdAt: AT,
  },
} as unknown as Application;

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
  attempts: [{ ...takenOver.attempts[0], status: "confirmed" }],
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
  if (url.endsWith("/search")) return respond({ items: [approved] });
  if (url.endsWith("/manual-submissions")) {
    return respond({ outcome: "started", attemptId: ATTEMPT, application: takenOver });
  }
  if (url.endsWith("/reconciliation")) return respond(applied);
  if (url.endsWith("/resume")) {
    return respond({ code: "applications_unavailable" }, 503);
  }
  return respond({ code: "application_not_found" }, 404);
}) as typeof globalThis.fetch;

declare global {
  interface Window {
    readD3AssuranceCalls(): RecordedCall[];
  }
}

window.readD3AssuranceCalls = () => structuredClone(calls);

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The browser-assurance root is missing");
createRoot(container).render(
  <ApplicationsWorkspace
    jobId={JOB}
    applyUrl="https://boards.example.test/jobs/1"
    fetchImplementation={syntheticFetch}
  />,
);
