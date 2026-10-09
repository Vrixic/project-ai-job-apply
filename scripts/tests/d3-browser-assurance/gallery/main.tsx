import type { Application } from "@ai-job-apply/api-contracts";
import { createRoot } from "react-dom/client";
import { NativeMaterialSession } from "../../../../frontend/web/lib/native-material-session";
import "../../../../frontend/web/app/styles.css";
import { ApplicationsWorkspace } from "../../../../frontend/web/app/applications-workspace";
import { AppliedJobsPanel } from "../../../../frontend/web/app/applied-jobs-panel";
import { JobSearchForm } from "../../../../frontend/web/app/job-search-form";
import { ResumePreviewSection } from "../../../../frontend/web/app/resume-preview-section";
import { MaterialSignOutSignal } from "../../../../frontend/web/app/signed-out/material-sign-out-signal";

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
let coverLetterScenario = false;
let nativeScenario = false;
let savedAnswerScenario = false;
let preparationReads = 0;
const PREPARATION = "00000000-0000-7000-8000-000000000020";

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
    headers: {
      "content-type": status >= 400 ? "application/problem+json" : "application/json",
      "cache-control": "no-store",
    },
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
  if (nativeScenario && (url.includes("/location?") || url.startsWith("https://"))) {
    const material = current?.currentPacket?.temporaryMaterials?.find(
      (value) =>
        value.kind === (url.includes("/cover-letter") ? "cover_letter" : "tailored_resume"),
    );
    if (!material || !current?.currentPacket) return respond({}, 404);
    if (url.includes("/location?"))
      return respond({
        schemaVersion: 1,
        packetId: PACKET,
        packetHash: HASH,
        temporaryMaterial: material,
        origin: `https://${ATTEMPT}.materials.example.test:8443`,
      });
    if (
      init.credentials !== "omit" ||
      (init.headers as Record<string, string>).authorization !==
        "Bearer synthetic-native-browser-token"
    )
      return respond({}, 403);
    if (url.includes("/file?")) {
      const format = new URL(url).searchParams.get("format");
      const bytes = new TextEncoder().encode("Synthetic approved file");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return respond({
        format,
        mediaType:
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: `synthetic.${format}`,
        sha256: hash,
        sizeBytes: bytes.length,
        contentSha256: HASH,
        contentBase64: btoa("Synthetic approved file"),
        temporaryMaterial: material,
      });
    }
    return respond(
      material.kind === "tailored_resume"
        ? {
            status: "ready",
            matchesPacket: true,
            contentSha256: HASH,
            temporaryMaterial: material,
            sections: [
              {
                kind: "experience",
                entries: [{ lines: ["Native synthetic resume preview"], bullets: [] }],
              },
            ],
          }
        : {
            status: "ready",
            matchesPacket: true,
            documentId: PREPARATION,
            version: 1,
            contentSha256: HASH,
            temporaryMaterial: material,
            reviewRequired: true,
            paragraphs: [{ text: "Native synthetic grounded cover letter", factIds: [JOB] }],
            model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
            promptVersion: "synthetic.v1",
          },
    );
  }
  if (url.endsWith("/jobs/search")) return respond({ items: [job] });
  if (url === "/api/platform/restricted-answers")
    return respond({
      answers: [
        {
          id: "00000000-0000-7000-8000-000000000022",
          fieldKey: "authorization.us_authorized",
          valueType: "boolean",
          sensitivity: "restricted",
          state: "active",
          context: "us.explicit",
          version: 7,
          confirmedAt: AT,
        },
      ],
    });
  if (url === `/api/platform/jobs/${JOB}`) return respond(job);
  if (url.endsWith("/applications/search")) return respond({ items: current ? [current] : [] });
  if (url === "/api/platform/applications") {
    current = preparing;
    return respond(current, 201);
  }
  if (url.endsWith("/packets")) {
    if (savedAnswerScenario) {
      const request = JSON.parse(String(init.body));
      const selection = request.vaultSelections?.[0];
      if (!selection || !current?.currentPacket) return respond({}, 400);
      const { fieldKey, ...reference } = selection;
      current = {
        ...current,
        revision: current.revision + 1,
        currentPacket: {
          ...current.currentPacket,
          id: "00000000-0000-7000-8000-000000000033",
          version: 2,
          packetHash: "b".repeat(64),
          form: request.form,
          fields: [
            ...current.currentPacket.fields,
            {
              fieldKey,
              value: false,
              origin: "answer_vault",
              sourceFactIds: [selection.id],
              confidence: 1,
              disposition: "review",
              requiresReview: true,
              reasons: ["restricted_answer"],
              vaultReference: { ...reference, validUntilEpochMs: null },
            },
          ],
        },
      } as Application;
      return respond(current, 201);
    }
    if (coverLetterScenario || nativeScenario) {
      const completedAtMs = Date.now();
      current = {
        ...review,
        currentPacket: {
          ...review.currentPacket,
          artifactHashes: { coverLetter: HASH, ...(nativeScenario ? { resume: HASH } : {}) },
          temporaryMaterials: [
            ...(nativeScenario
              ? [
                  {
                    schemaVersion: 1 as const,
                    kind: "tailored_resume" as const,
                    generationId: ATTEMPT,
                    version: 1,
                    contentSha256: HASH,
                    completedAtMs,
                    expiresAtMs: completedAtMs + 1_800_000,
                  },
                ]
              : []),
            {
              schemaVersion: 1,
              kind: "cover_letter",
              generationId: PREPARATION,
              version: 1,
              contentSha256: HASH,
              completedAtMs,
              expiresAtMs: completedAtMs + 1_800_000,
            },
          ],
        },
      } as Application;
      return respond(
        { id: PREPARATION, applicationId: APP, state: "queued", createdAt: AT, updatedAt: AT },
        202,
      );
    }
    current = review;
    return respond(current, 201);
  }
  if (url.includes("/preparations/")) {
    preparationReads += 1;
    return respond({
      id: PREPARATION,
      applicationId: APP,
      state: preparationReads === 1 ? "running" : "succeeded",
      ...(preparationReads > 1 ? { result: { packetId: PACKET, revision: 2 } } : {}),
      createdAt: AT,
      updatedAt: AT,
    });
  }
  if (url === `/api/platform/applications/${APP}`) return respond(current);
  if (url.endsWith("/approval")) {
    if (savedAnswerScenario && current?.currentPacket && approved.approval) {
      const request = JSON.parse(String(init.body));
      current = {
        ...current,
        status: "approved",
        revision: current.revision + 1,
        currentAction: "ready_to_submit",
        approval: {
          ...approved.approval,
          packetHash: current.currentPacket.packetHash,
          acknowledgedFieldKeys: request.acknowledgedFieldKeys,
        },
      };
      return respond(current);
    }
    current = nativeScenario
      ? ({ ...approved, currentPacket: current?.currentPacket } as Application)
      : approved;
    return respond(current);
  }
  if (url.endsWith("/manual-submissions")) {
    if (savedAnswerScenario && current) {
      const observation = (
        JSON.parse(String(init.body)) as {
          observedForm?: {
            confirmed?: boolean;
            form?: { formHash?: string };
            capturedAtEpochMs?: number;
          };
        }
      ).observedForm;
      if (
        !observation?.confirmed ||
        observation.form?.formHash !== current.currentPacket?.form?.formHash ||
        !observation.capturedAtEpochMs ||
        Date.now() >= observation.capturedAtEpochMs + 60_000
      )
        throw new Error("Synthetic manual form confirmation missing");
      current = {
        ...takenOver,
        currentPacket: current.currentPacket,
        revision: current.revision + 1,
      } as Application;
      return respond({ outcome: "started", attemptId: ATTEMPT, application: current });
    }
    current = takenOver;
    return respond({ outcome: "started", attemptId: ATTEMPT, application: takenOver });
  }
  if (url.endsWith("/reconciliation")) {
    if (savedAnswerScenario && current) {
      current = {
        ...applied,
        currentPacket: current.currentPacket,
        revision: current.revision + 1,
      } as Application;
      return respond(current);
    }
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
    showD3CoverLetterPreparation(): void;
    showD3NativeJourney(): void;
    showD3SignedOut(): void;
    showD3SavedAnswerJourney(): void;
    showD3WithdrawalRecovery(status: "approved" | "takeover"): void;
  }
}

window.readD3AssuranceCalls = () => structuredClone(calls);
window.fetch = syntheticFetch;

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The browser-assurance root is missing");
const root = createRoot(container);
window.showD3SavedAnswerJourney = () => {
  current = review;
  savedAnswerScenario = true;
  coverLetterScenario = false;
  nativeScenario = false;
  const source = job.sources[0];
  if (!source) throw new Error("Missing synthetic source");
  source.canonicalUrl = "https://employer.example/jobs/synthetic";
  calls.length = 0;
  root.render(
    <div>
      <h1>Synthetic saved-answer journey</h1>
      <ApplicationsWorkspace
        key="saved-answer-journey"
        jobId={JOB}
        savedAnswerSelectionEnabled
        fetchImplementation={syntheticFetch}
      />
      <AppliedJobsPanel authenticated />
    </div>,
  );
};
window.showD3WithdrawalRecovery = (status) => {
  const base = status === "approved" ? approved : takenOver;
  let recovery: Application = {
    id: APP,
    canonicalJobId: JOB,
    status,
    revision: base.revision,
    currentAction: status === "approved" ? "re_review" : "complete_manually",
    packetAvailability: "withheld",
    attempts: base.attempts,
    createdAt: AT,
    updatedAt: AT,
  };
  calls.length = 0;
  const recoveryFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (url.endsWith("/search")) return respond({ items: [recovery] });
    if (url.endsWith("/reopen"))
      recovery = { ...recovery, status: "review_required", revision: recovery.revision + 1 };
    if (url.endsWith("/packets")) recovery = { ...review, revision: recovery.revision + 1 };
    if (url.endsWith("/resume")) return respond({ status: "no_resume", matchesPacket: false });
    if (url.endsWith("/reconciliation"))
      recovery = {
        ...recovery,
        status: "applied",
        currentAction: "none",
        revision: recovery.revision + 1,
        attempts: applied.attempts,
      };
    return respond(recovery);
  }) as typeof globalThis.fetch;
  root.render(
    <div>
      <h1>Synthetic withdrawal recovery</h1>
      <ApplicationsWorkspace
        key={`withdrawal-${status}`}
        jobId={JOB}
        applicationId={APP}
        applyUrl="https://employer.example/jobs/synthetic"
        fetchImplementation={recoveryFetch}
      />
    </div>,
  );
};
window.showD3SignedOut = () => root.render(<MaterialSignOutSignal />);
window.showD3CoverLetterPreparation = () => {
  current = undefined;
  coverLetterScenario = true;
  preparationReads = 0;
  calls.length = 0;
  root.render(
    <div>
      <h1>Synthetic cover-letter preparation</h1>
      <ApplicationsWorkspace
        jobId={JOB}
        coverLetterPreparationEnabled
        fetchImplementation={syntheticFetch}
      />
    </div>,
  );
};
window.showD3NativeJourney = () => {
  // Authentication is deliberately simulated; the production session.read and native reader remain real.
  NativeMaterialSession.prototype.signIn = async function () {
    this.clear();
    Reflect.set(this, "token", "synthetic-native-browser-token");
    Reflect.set(this, "deadline", Date.now() + 600_000);
  };
  current = undefined;
  nativeScenario = true;
  coverLetterScenario = false;
  preparationReads = 0;
  calls.length = 0;
  root.render(
    <JobSearchForm
      authenticated
      savedPanel={<p>No saved jobs.</p>}
      appliedPanel={<AppliedJobsPanel authenticated />}
    />,
  );
};
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
