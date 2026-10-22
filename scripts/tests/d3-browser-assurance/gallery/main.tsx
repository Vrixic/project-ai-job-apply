import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import { validateApplicationNativeTransferCommit } from "@ai-job-apply/api-contracts/browser-validators";
import { createRoot } from "react-dom/client";
import "../../../../frontend/web/app/styles.css";
import { ApplicationsWorkspace } from "../../../../frontend/web/app/applications-workspace";
import { AppliedJobsPanel } from "../../../../frontend/web/app/applied-jobs-panel";
import { CandidateNameProvider } from "../../../../frontend/web/app/candidate-name-context";
import { JobSearchForm } from "../../../../frontend/web/app/job-search-form";
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
    id: "00000000-0000-7000-8000-000000000011",
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

const record = (url: string, init: RequestInit) => {
  calls.push({
    url,
    method: init.method ?? "GET",
    ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    ...((init.headers as Record<string, string> | undefined)?.["idempotency-key"]
      ? { idempotencyKey: (init.headers as Record<string, string>)["idempotency-key"] }
      : {}),
  });
};

// Synthetic Chrome receiver for actual UI checks. No installed-extension acceptance or ATS effect.
// The candidate "opens the extension on the employer page" by setting `selected` from the test.
const extensionMessages: Array<{ schema: string; keys: string[] }> = [];
const extension = { selected: false, answerIntents: true, admission: undefined as unknown };
let extensionApplication: () => Application | undefined = () => current;
Object.defineProperty(window, "chrome", {
  configurable: true,
  value: {
    runtime: {
      sendMessage(target: string, message: { schema: string }, callback: (value: unknown) => void) {
        const app = extensionApplication();
        extensionMessages.push({ schema: message.schema, keys: Object.keys(message).sort() });
        if (target !== "a".repeat(32)) return callback({ error: "unavailable" });
        if (message.schema === "application-apply-intent.v1") {
          if (!extension.answerIntents) return callback(undefined);
          return callback({
            schema: "application-apply-intent-receipt.v1",
            expiresAtMs: Date.now() + 600_000,
          });
        }
        const packet = app?.currentPacket;
        if (!packet || !app?.approval) return callback({ error: "unavailable" });
        if (message.schema === "application-native-transfer-begin.v1") {
          if (!extension.selected) return callback({ error: "unavailable" });
          extension.admission = {
            ...message,
            schema: "application-native-transfer-admission.v1",
            nonce: "c".repeat(64),
            expiresAtMs: Math.min(
              Date.now() + 30_000,
              ...(packet.temporaryMaterials ?? []).map((material) => material.expiresAtMs),
            ),
            approvalId: app.approval.id,
            revision: app.revision,
            materials: packet.temporaryMaterials,
          };
          return callback(extension.admission);
        }
        if (message.schema === "application-native-transfer-commit.v1") {
          const commit = message as unknown;
          if (
            !validateApplicationNativeTransferCommit(commit) ||
            JSON.stringify(commit.admission) !== JSON.stringify(extension.admission)
          )
            return callback({ error: "unavailable" });
          const admission = commit.admission;
          extension.admission = undefined;
          return callback({
            schema: "application-native-transfer-receipt.v1",
            nonce: admission.nonce,
            applicationId: admission.applicationId,
            packetId: admission.packetId,
            packetHash: admission.packetHash,
            expiresAtMs: Math.min(
              Date.parse(app.approval.expiresAt),
              ...admission.materials.map((material) => material.expiresAtMs),
            ),
          });
        }
        extension.admission = undefined;
        return callback({ ok: true });
      },
    },
  },
});
Object.assign(window, {
  readD3ExtensionMessages: () => structuredClone(extensionMessages),
  setD3ExtensionSelected: (value: boolean) => {
    extension.selected = value;
  },
});

const syntheticFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  record(url, init);
  if (url.includes("/cover-letter/content")) {
    const material = current?.currentPacket?.temporaryMaterials?.find(
      (value) => value.kind === "cover_letter",
    );
    if (!material) return respond({}, 404);
    return respond({
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
    });
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
    if (coverLetterScenario) {
      const completedAtMs = Date.now();
      current = {
        ...review,
        currentPacket: {
          ...review.currentPacket,
          artifactHashes: { coverLetter: HASH },
          temporaryMaterials: [
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
    if (current?.currentPacket && approved.approval) {
      const request = JSON.parse(String(init.body));
      current = {
        ...(savedAnswerScenario ? current : approved),
        status: "approved",
        revision: (current.revision ?? 2) + 1,
        currentAction: "ready_to_submit",
        currentPacket: current.currentPacket,
        approval: {
          ...approved.approval,
          packetHash: current.currentPacket.packetHash,
          acknowledgedFieldKeys: request.acknowledgedFieldKeys,
        },
      } as Application;
      return respond(current);
    }
    current = approved;
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

/**
 * A real one-page PDF (standard Helvetica, a heading and two bullets) so Chrome and PDF.js draw an
 * actual document in the preview. Offsets are computed, so the cross-reference table is valid.
 */
function syntheticResumePdf(): Uint8Array {
  const text = (size: number, y: number, value: string, font = "F1") =>
    `BT /${font} ${size} Tf 54 ${y} Td (${value}) Tj ET`;
  const stream = [
    text(20, 730, "Synthetic Candidate", "F2"),
    text(11, 706, "Senior Engineer, Example Co"),
    text(11, 686, "- Built the billing service"),
    text(11, 670, "- Mentored two engineers"),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

type GenerationMode = "ready" | "failed" | "no_resume" | "never";

/**
 * A stateful stand-in for the authenticated BFF for the generate-then-apply journey. The real
 * workspace, preview, polling, hand-off and extension-transfer code runs against it; only the
 * network, identity and native process are simulated.
 */
function createApplyBff(options: { mode: GenerationMode; pollsUntilResolved: number }) {
  let app: Application | undefined;
  let revision = 1;
  let packetCounter = 0;
  let polls = 0;
  let material: ApplicationTemporaryMaterial | undefined;
  const pdf = syntheticResumePdf();
  let pdfSha256 = "";
  void crypto.subtle.digest("SHA-256", pdf).then((digest) => {
    pdfSha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  });
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const packet = (resume: "generate" | "uploaded") => {
    packetCounter += 1;
    const hash = `${packetCounter.toString(16).padStart(2, "0")}${"e".repeat(62)}`;
    return {
      id: `00000000-0000-7000-8000-0000000001${String(packetCounter).padStart(2, "0")}`,
      version: packetCounter,
      packetHash: hash,
      jobRevision: hash,
      artifactHashes: resume === "uploaded" ? { resume: "d".repeat(64) } : {},
      fields: [
        {
          fieldKey: "contact.email",
          value: "candidate@example.test",
          origin: "confirmed_fact",
          sourceFactIds: [PACKET],
          confidence: 1,
          disposition: "auto",
          reasons: [],
          requiresReview: false,
        },
        ...(resume === "uploaded"
          ? [
              {
                fieldKey: "documents.resume",
                value: "d".repeat(64),
                origin: "confirmed_fact",
                sourceFactIds: [PACKET],
                confidence: 1,
                disposition: "review",
                reasons: ["explicit_each_time"],
                requiresReview: true,
              },
            ]
          : []),
      ],
      createdAt: new Date().toISOString(),
    };
  };
  const next = (status: Application["status"], extras: Record<string, unknown> = {}) => {
    revision += 1;
    const now = new Date().toISOString();
    return {
      id: APP,
      canonicalJobId: JOB,
      status,
      revision,
      currentAction:
        status === "approved"
          ? "ready_to_submit"
          : status === "review_required"
            ? "review_and_approve"
            : status === "takeover"
              ? "complete_manually"
              : status === "applied"
                ? "none"
                : "prepare_packet",
      attempts: [],
      createdAt: now,
      updatedAt: now,
      ...extras,
    } as unknown as Application;
  };
  const resolve = () => {
    const generation = app?.resumeGeneration;
    if (!app?.currentPacket || generation?.state !== "preparing") return;
    polls += 1;
    if (polls < options.pollsUntilResolved || options.mode === "never") return;
    const requestedAt = generation.requestedAt;
    if (options.mode === "ready") {
      material = {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: ATTEMPT,
        version: 1,
        contentSha256: HASH,
        completedAtMs: Date.now(),
        expiresAtMs: Date.now() + 1_800_000,
      };
      const generated = packet("generate");
      generated.artifactHashes = { resume: HASH };
      generated.fields.push({
        fieldKey: "documents.resume",
        value: HASH,
        origin: "generated",
        sourceFactIds: [],
        confidence: 1,
        disposition: "review",
        reasons: ["explicit_each_time", "generated_content"],
        requiresReview: true,
      });
      app = next("review_required", {
        currentPacket: { ...generated, temporaryMaterials: [material] },
        resumeGeneration: { state: "ready", requestedAt },
      });
      return;
    }
    app = next("review_required", {
      currentPacket: app.currentPacket,
      resumeGeneration: {
        state: "failed",
        errorCode: options.mode === "no_resume" ? "no_resume" : "generation_failed",
        requestedAt,
      },
    });
  };
  extensionApplication = () => app;
  const fetchApply = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.startsWith("/api/platform/applications")) return syntheticFetch(input, init);
    record(url, init);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url === "/api/platform/applications/search") return respond({ items: app ? [app] : [] });
    if (url === "/api/platform/applications" && method === "POST") {
      app = next("preparing");
      return respond(app, 201);
    }
    if (!app || !url.startsWith(`/api/platform/applications/${APP}`))
      return respond({ code: "application_not_found" }, 404);
    const rest = url.slice(`/api/platform/applications/${APP}`.length);
    if (rest === "" && method === "GET") {
      resolve();
      return respond(app);
    }
    if (rest === "/packets" && method === "POST") {
      const resume = body.resume === "uploaded" ? "uploaded" : "generate";
      polls = 0;
      app = next("review_required", {
        currentPacket: packet(resume),
        ...(resume === "generate"
          ? { resumeGeneration: { state: "preparing", requestedAt: new Date().toISOString() } }
          : {}),
      });
      return respond(app, 201);
    }
    if (rest === "/reopen" && method === "POST") {
      app = next("review_required", { currentPacket: app.currentPacket });
      return respond(app);
    }
    if (rest === "/approval" && method === "POST") {
      const current = app.currentPacket;
      if (!current || body.packetHash !== current.packetHash)
        return respond({ code: "application_approval_refused" }, 409);
      const missing = current.fields.filter(
        (field) => field.requiresReview && !body.acknowledgedFieldKeys.includes(field.fieldKey),
      );
      if (missing.length) return respond({ code: "application_approval_refused" }, 409);
      app = next("approved", {
        currentPacket: current,
        ...(app.resumeGeneration ? { resumeGeneration: app.resumeGeneration } : {}),
        approval: {
          id: "00000000-0000-7000-8000-000000000011",
          packetHash: current.packetHash,
          approvedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          acknowledgedFieldKeys: body.acknowledgedFieldKeys,
        },
      });
      return respond(app);
    }
    if (rest === "/manual-submissions" && method === "POST") {
      app = next("takeover", {
        currentPacket: app.currentPacket,
        attempts: takenOver.attempts,
      });
      return respond({ outcome: "started", attemptId: ATTEMPT, application: app });
    }
    if (rest.endsWith("/reconciliation") && method === "POST") {
      app = next("applied", { currentPacket: app.currentPacket, attempts: applied.attempts });
      return respond(app);
    }
    if (rest.startsWith("/resume/content") && method === "GET") {
      const query = new URL(url, location.origin).searchParams;
      if (
        !app.currentPacket ||
        !material ||
        query.get("packetHash") !== app.currentPacket.packetHash
      )
        return respond({ code: "application_packet_stale" }, 409);
      if (query.get("format") === "pdf")
        return respond({
          format: "pdf",
          mediaType: "application/pdf",
          fileName: "tailored-resume.pdf",
          sha256: pdfSha256,
          sizeBytes: pdf.byteLength,
          contentSha256: HASH,
          contentBase64: base64(pdf),
          temporaryMaterial: material,
        });
      return respond({ code: "not_found" }, 404);
    }
    return respond({ code: "application_not_found" }, 404);
  }) as typeof globalThis.fetch;
  return fetchApply;
}

declare global {
  interface Window {
    readD3AssuranceCalls(): RecordedCall[];
    readD3ExtensionMessages(): Array<{ schema: string; keys: string[] }>;
    setD3ExtensionSelected(value: boolean): void;
    setD3ExtensionAnswers(value: boolean): void;
    showD3CoverLetterPreparation(): void;
    showD3ApplyJourney(mode?: GenerationMode, pollsUntilResolved?: number): void;
    showD3SignedOut(): void;
    showD3SavedAnswerJourney(): void;
    showD3WithdrawalRecovery(status: "approved" | "takeover"): void;
  }
}

window.readD3AssuranceCalls = () => structuredClone(calls);
window.setD3ExtensionAnswers = (value) => {
  extension.answerIntents = value;
};
window.fetch = syntheticFetch;

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The browser-assurance root is missing");
const root = createRoot(container);
window.showD3SavedAnswerJourney = () => {
  current = review;
  savedAnswerScenario = true;
  coverLetterScenario = false;
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
        applyUrl="https://employer.example/jobs/synthetic"
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
    record(url, init);
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
  savedAnswerScenario = false;
  preparationReads = 0;
  calls.length = 0;
  root.render(
    <div>
      <h1>Synthetic cover-letter preparation</h1>
      <ApplicationsWorkspace
        jobId={JOB}
        applyUrl="https://boards.example.test/jobs/1"
        coverLetterPreparationEnabled
        fetchImplementation={syntheticFetch}
      />
    </div>,
  );
};
let journeys = 0;
window.showD3ApplyJourney = (mode = "ready", pollsUntilResolved = 2) => {
  current = undefined;
  coverLetterScenario = false;
  savedAnswerScenario = false;
  calls.length = 0;
  extensionMessages.length = 0;
  extension.selected = false;
  extension.answerIntents = true;
  const source = job.sources[0];
  if (source) source.canonicalUrl = "https://boards.example.test/jobs/1";
  window.fetch = createApplyBff({ mode, pollsUntilResolved });
  journeys += 1;
  root.render(
    <CandidateNameProvider value="Vrij Patel">
      <JobSearchForm
        key={`journey-${journeys}`}
        authenticated
        savedPanel={<p>No saved jobs.</p>}
        appliedPanel={<AppliedJobsPanel authenticated />}
      />
    </CandidateNameProvider>,
  );
};
root.render(
  <JobSearchForm
    authenticated
    savedPanel={<p>No saved jobs in this synthetic journey.</p>}
    appliedPanel={<AppliedJobsPanel authenticated />}
  />,
);
