// @vitest-environment jsdom

import type {
  JobPreferenceSet,
  Operation,
  ProfileFact,
  ResumeDocument,
} from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundationForm } from "./foundation-form";
import { ProfileFactsForm } from "./profile-facts-form";
import { ResumeUploadForm } from "./resume-upload-form";

const emptyFacts = { facts: [], confirmedCount: 0, proposedCount: 0 };
const emptyResumes = { documents: [] };
const privateProblemCanary = "synthetic-private-onboarding-problem-never-render";

function proposedFact(key = "stale_candidate_skill"): ProfileFact {
  return {
    id: "019c0000-0000-7000-8000-000000000040",
    kind: "skill",
    key,
    value: "Prior account value",
    verification: "proposed",
    sensitivity: "confidential",
    source: { type: "resume", reference: "resume:opaque" },
    version: 1,
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:00.000Z",
  };
}

function confirmedDirectFact(key: string, value = "Synthetic confirmed value"): ProfileFact {
  return {
    ...proposedFact(key),
    key,
    value,
    verification: "confirmed",
    source: { type: "user", reference: "direct-entry" },
  };
}

function resumeDocument(status: ResumeDocument["status"] = "scanning"): ResumeDocument {
  return {
    id: "019c0000-0000-7000-8000-000000000090",
    fileName: "synthetic-prior-account.pdf",
    mediaType: "application/pdf",
    sizeBytes: 3,
    sha256: "a".repeat(64),
    status,
    ...(status === "parsed" ? { pageCount: 1, characterCount: 24 } : {}),
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:02.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function setControlValue(control: FormControl, value: string): void {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The form control value setter is unavailable");
  setter.call(control, value);
  control.dispatchEvent(
    new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
}

function labelledControl<T extends FormControl>(
  container: HTMLElement,
  labelText: string,
  selector: string,
): T {
  const control = Array.from(container.querySelectorAll("label"))
    .filter((candidate) => candidate.textContent?.includes(labelText))
    .map((candidate) => candidate.querySelector<T>(selector))
    .find((candidate): candidate is T => candidate !== null);
  if (!control) throw new Error(`Could not find ${labelText}`);
  return control;
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Could not find button ${name}`);
  return button;
}

function directFactForm(container: HTMLElement): HTMLFormElement {
  const form = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((candidate) =>
    candidate.textContent?.includes("Fact category"),
  );
  if (!form) throw new Error("The direct fact form must be rendered");
  return form;
}

function fillDirectFact(form: HTMLFormElement, key: string, value: string): void {
  setControlValue(labelledControl<HTMLSelectElement>(form, "Fact category", "select"), "skill");
  setControlValue(labelledControl<HTMLInputElement>(form, "Fact name", "input"), key);
  setControlValue(labelledControl<HTMLInputElement>(form, "Confirmed value", "input"), value);
}

function foundation(authenticated = true) {
  return (
    <FoundationForm
      authConfigured
      authConformanceEnabled={false}
      authenticationFailed={false}
      authenticated={authenticated}
      crossUserProbeArmed={false}
      workloadConformanceEnabled={false}
    />
  );
}

function profileFacts(authenticated = true) {
  return <ProfileFactsForm authenticated={authenticated} />;
}

function resumeUpload(authenticated = true, onDocumentParsed?: () => void) {
  return (
    <ResumeUploadForm
      authenticated={authenticated}
      {...(onDocumentParsed ? { onDocumentParsed } : {})}
    />
  );
}

describe("coordinated onboarding flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts without fabricated preferences and sends every explicit preference", async () => {
    let submittedPreferences: unknown;
    const savedPreferences: JobPreferenceSet = {
      id: "019c0000-0000-7000-8000-000000000001",
      version: 1,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Platform Engineer, Core", "Systems\nEngineer"],
      locations: ["New York,\nNY", "Remote - US"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["part_time", "contract"],
      salaryMinimum: 120_000,
      salaryCurrency: "USD",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse({ title: "Not found" }, 404);
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          submittedPreferences = JSON.parse(String(init.body));
          return jsonResponse({
            preferences: savedPreferences,
            operationId: "019c0000-0000-7000-8000-000000000002",
          });
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));

    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    const firstTargetRole = labelledControl<HTMLTextAreaElement>(
      container,
      "Target role 1",
      "textarea",
    );
    expect(firstTargetRole.value).toBe("");
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(
      container.querySelectorAll<HTMLInputElement>(".choice-option input:checked"),
    ).toHaveLength(0);

    await act(async () => {
      setControlValue(firstTargetRole, "Platform Engineer, Core");
      buttonNamed(container, "Add target role").click();
      buttonNamed(container, "Add target role").click();
    });
    await act(async () => {
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 2", "textarea"),
        "Remove me",
      );
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 3", "textarea"),
        "Systems\nEngineer",
      );
      expect(buttonNamed(container, "Remove target role 2")).toBeTruthy();
      buttonNamed(container, "Remove target role 2").click();
      buttonNamed(container, "Add location").click();
      buttonNamed(container, "Add location").click();
    });
    await act(async () => {
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Location 1", "textarea"),
        "New York,\nNY",
      );
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Location 2", "textarea"),
        "Remote - US",
      );
      expect(buttonNamed(container, "Remove location 2")).toBeTruthy();
      labelledControl<HTMLInputElement>(container, "Remote", 'input[type="checkbox"]').click();
      labelledControl<HTMLInputElement>(container, "Hybrid", 'input[type="checkbox"]').click();
      labelledControl<HTMLInputElement>(container, "Part-time", 'input[type="checkbox"]').click();
      labelledControl<HTMLInputElement>(container, "Contract", 'input[type="checkbox"]').click();
      setControlValue(
        labelledControl<HTMLInputElement>(container, "Minimum compensation amount", "input"),
        "120000",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(container, "Compensation currency", "input"),
        "usd",
      );
    });
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(submittedPreferences).toEqual({
      targetRoles: ["Platform Engineer, Core", "Systems\nEngineer"],
      locations: ["New York,\nNY", "Remote - US"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["part_time", "contract"],
      salaryMinimum: 120_000,
      salaryCurrency: "USD",
    });
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
    expect(container.textContent).not.toContain("Profile readiness");
  });

  it("locks preference inputs while saving and ignores a response after sign-out", async () => {
    const pendingSave = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse({ title: "Not found" }, 404);
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return pendingSave.promise;
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    const targetRoles = labelledControl<HTMLTextAreaElement>(
      container,
      "Target role 1",
      "textarea",
    );
    await act(async () => {
      setControlValue(targetRoles, "Platform Engineer");
      labelledControl<HTMLInputElement>(container, "Remote", 'input[type="checkbox"]').click();
      labelledControl<HTMLInputElement>(container, "Full-time", 'input[type="checkbox"]').click();
    });
    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(targetRoles.matches(":disabled")).toBe(true);
    await act(async () => root.render(foundation(false)));
    await act(async () =>
      pendingSave.resolve(
        jsonResponse({
          preferences: {
            id: "019c0000-0000-7000-8000-000000000009",
            version: 1,
            updatedAt: "2026-08-15T12:00:00.000Z",
            targetRoles: ["Stale role"],
            locations: [],
            workModes: [],
            employmentTypes: [],
          },
          operationId: "019c0000-0000-7000-8000-000000000010",
        }),
      ),
    );

    expect(container.querySelector('form[aria-label="Job preferences"]')).toBeNull();
    expect(container.textContent).not.toContain("Preferences saved");
  });

  it.each([true, false])(
    "does not display or overwrite a legacy sponsorship value of %s",
    async (requiresSponsorship) => {
      let putCount = 0;
      const preferences: JobPreferenceSet = {
        id: "019c0000-0000-7000-8000-00000000000a",
        version: 2,
        updatedAt: "2026-08-15T12:00:00.000Z",
        targetRoles: ["Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        requiresSponsorship,
      };
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const path = requestPath(input);
          if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
            return jsonResponse(preferences);
          }
          if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
            putCount += 1;
            return jsonResponse({ preferences, operationId: "unexpected" });
          }
          if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
          if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
          throw new Error(`Unexpected request: ${path}`);
        }),
      );

      await act(async () => root.render(foundation()));
      expect(container.textContent).not.toContain("Employer sponsorship");
      expect(container.textContent).toContain(
        "These saved preferences contain a legacy sponsorship answer.",
      );
      const preferenceForm = container.querySelector<HTMLFormElement>(
        'form[aria-label="Job preferences"]',
      );
      await act(async () =>
        preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );

      expect(putCount).toBe(0);
      expect(container.textContent).toContain(
        "Saving is unavailable until that answer moves to the restricted-data boundary.",
      );
    },
  );

  it("clears a prior account warning and fields before a new account returns no preferences", async () => {
    let preferenceReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences") {
          preferenceReads += 1;
          return preferenceReads === 1
            ? jsonResponse({
                id: "019c0000-0000-7000-8000-00000000000b",
                version: 1,
                updatedAt: "2026-08-15T12:00:00.000Z",
                targetRoles: ["Prior account role"],
                locations: [],
                workModes: ["remote"],
                employmentTypes: ["full_time"],
                requiresSponsorship: true,
              })
            : jsonResponse({ title: "Not found" }, 404);
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    expect(container.textContent).toContain("legacy sponsorship answer");
    await act(async () => root.render(foundation(false)));
    expect(container.textContent).not.toContain("legacy sponsorship answer");
    expect(container.querySelector('form[aria-label="Job preferences"]')).toBeNull();
    await act(async () => root.render(foundation()));

    expect(preferenceReads).toBe(2);
    expect(container.textContent).not.toContain("legacy sponsorship answer");
    expect(labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea").value).toBe(
      "",
    );
  });

  it("hydrates all saved fields and presents the durable result as a narrow preference check", async () => {
    vi.useFakeTimers();
    const preferences: JobPreferenceSet = {
      id: "019c0000-0000-7000-8000-000000000011",
      version: 3,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Engineer"],
      locations: [],
      workModes: ["on_site"],
      employmentTypes: ["internship"],
    };
    const completed: Operation = {
      id: "019c0000-0000-7000-8000-000000000012",
      kind: "profile_readiness",
      state: "succeeded",
      result: {
        completionPercent: 67,
        missingFields: ["locations", "salary"],
        calculatedAt: "2026-08-15T12:00:01.000Z",
      },
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:01.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferences);
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return jsonResponse({ preferences, operationId: completed.id });
        }
        if (path === `/api/platform/operations/${completed.id}`) return jsonResponse(completed);
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    expect(labelledControl<HTMLInputElement>(container, "On-site", "input").checked).toBe(true);
    expect(labelledControl<HTMLInputElement>(container, "Internship", "input").checked).toBe(true);
    expect(container.textContent).not.toContain("Employer sponsorship");

    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(container.textContent).toContain("Saved-preference check: succeeded");
    expect(container.textContent).toContain(
      "Optional preference details not saved: locations, salary.",
    );
    expect(container.textContent).toContain("It does not assess resume processing");
    expect(container.textContent).not.toContain("Profile readiness");
    expect(container.textContent).not.toContain("67%");
  });

  it("shows fixed candidate-safe copy for preference load and save failures", async () => {
    let preferenceReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          preferenceReads += 1;
          return jsonResponse(
            {
              code: "private_database_failure",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return jsonResponse(
            { code: "invalid_request", title: privateProblemCanary, detail: privateProblemCanary },
            400,
          );
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    expect(preferenceReads).toBe(1);
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => {
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea"),
        "Platform Engineer",
      );
      labelledControl<HTMLInputElement>(container, "Remote", 'input[type="checkbox"]').click();
      labelledControl<HTMLInputElement>(container, "Full-time", 'input[type="checkbox"]').click();
    });
    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(container.textContent).toContain("Check your job preferences and try again.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(buttonNamed(container, "Save preferences").disabled).toBe(false);
  });

  it("aborts and ignores an operation poll when the user signs out", async () => {
    vi.useFakeTimers();
    const operationId = "019c0000-0000-7000-8000-000000000019";
    const preferences: JobPreferenceSet = {
      id: "019c0000-0000-7000-8000-000000000018",
      version: 1,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const pendingPoll = deferred<Response>();
    let pollCount = 0;
    let pollSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferences);
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return jsonResponse({ preferences, operationId });
        }
        if (path === `/api/platform/operations/${operationId}`) {
          pollCount += 1;
          pollSignal = init?.signal;
          return pendingPoll.promise;
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    act(() => vi.advanceTimersByTime(1_500));
    expect(pollCount).toBe(1);

    await act(async () => root.render(foundation(false)));
    expect(pollSignal?.aborted).toBe(true);
    await act(async () =>
      pendingPoll.resolve(
        jsonResponse({
          id: operationId,
          kind: "profile_readiness",
          state: "succeeded",
          result: {
            completionPercent: 100,
            missingFields: [],
            calculatedAt: "2026-08-15T12:00:02Z",
          },
          createdAt: "2026-08-15T12:00:00Z",
          updatedAt: "2026-08-15T12:00:02Z",
        }),
      ),
    );

    expect(container.textContent).not.toContain("Saved-preference check: succeeded");
  });

  it("shows fixed candidate-safe copy when the saved-preference operation fails", async () => {
    vi.useFakeTimers();
    const operationId = "019c0000-0000-7000-8000-00000000001a";
    const preferences: JobPreferenceSet = {
      id: "019c0000-0000-7000-8000-00000000001b",
      version: 1,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferences);
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return jsonResponse({ preferences, operationId });
        }
        if (path === `/api/platform/operations/${operationId}`) {
          return jsonResponse(
            {
              code: "private_database_failure",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts") return jsonResponse(emptyFacts);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    const preferenceForm = container.querySelector<HTMLFormElement>(
      'form[aria-label="Job preferences"]',
    );
    await act(async () =>
      preferenceForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(container.textContent).toContain("The saved check is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
  });

  it("reloads proposed facts after a resume reaches parsed and announces the result", async () => {
    vi.useFakeTimers();
    const scanning: ResumeDocument = {
      id: "019c0000-0000-7000-8000-000000000021",
      fileName: "synthetic-resume.pdf",
      mediaType: "application/pdf",
      sizeBytes: 4096,
      sha256: "a".repeat(64),
      status: "scanning",
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
    };
    const parsed: ResumeDocument = {
      ...scanning,
      status: "parsed",
      pageCount: 1,
      characterCount: 24,
      updatedAt: "2026-08-15T12:00:02.000Z",
    };
    const proposal: ProfileFact = {
      id: "019c0000-0000-7000-8000-000000000022",
      kind: "skill",
      key: "skill",
      value: "Synthetic TypeScript",
      verification: "proposed",
      sensitivity: "standard",
      source: { type: "resume", reference: "resume:opaque" },
      evidence: {
        supportingSpans: [
          {
            documentId: scanning.id,
            documentVersion: 1,
            parserVersion: "resume-parser-v1",
            blockIndex: 0,
            startOffset: 0,
            endOffset: 20,
            page: 1,
          },
        ],
      },
      version: 1,
      createdAt: "2026-08-15T12:00:02.000Z",
      updatedAt: "2026-08-15T12:00:02.000Z",
    };
    let resumeReads = 0;
    let factReads = 0;
    const staleInitialFacts = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences") {
          return jsonResponse({ title: "Not found" }, 404);
        }
        if (path === "/api/platform/resumes") {
          resumeReads += 1;
          return jsonResponse({ documents: [resumeReads === 1 ? scanning : parsed] });
        }
        if (path === "/api/platform/profile-facts") {
          factReads += 1;
          return factReads === 1
            ? staleInitialFacts.promise
            : jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    const resumeHeading = container.querySelector("#resume-upload-heading");
    const factsHeading = container.querySelector("#profile-facts-heading");
    if (!(resumeHeading instanceof HTMLElement) || !(factsHeading instanceof HTMLElement)) {
      throw new Error("The resume and facts headings must both be rendered");
    }
    expect(
      resumeHeading.compareDocumentPosition(factsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(factReads).toBe(2);
    expect(container.textContent).toContain(
      "Resume parsing finished. Checking for extracted facts to review.",
    );
    expect(container.textContent).toContain("1 extracted fact is waiting for your review.");
    expect(container.textContent).toContain("Synthetic TypeScript");

    await act(async () => staleInitialFacts.resolve(jsonResponse(emptyFacts)));
    expect(container.textContent).toContain("1 extracted fact is waiting for your review.");
    expect(container.textContent).toContain("Synthetic TypeScript");
  });

  it("shows fixed candidate-safe copy for profile-fact list and create failures", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          return reads === 1
            ? jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              )
            : jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          return jsonResponse(
            {
              code: "private_database_failure",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => root.render(<ProfileFactsForm authenticated refreshVersion={1} />));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "synthetic_private_fact",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Synthetic private value",
      );
    });
    await act(async () =>
      factForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(labelledControl<HTMLInputElement>(factForm, "Fact name", "input").value).toBe(
      "synthetic_private_fact",
    );
    expect(factForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
  });

  it("keeps rapid create and update activation in one mutation and clears its deadline", async () => {
    vi.useFakeTimers();
    const proposal = proposedFact("single_flight_proposal");
    const pendingCreate = deferred<Response>();
    let createSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
      }
      if (path === "/api/platform/profile-facts" && init?.method === "POST") {
        createSignal = init.signal ?? undefined;
        return pendingCreate.promise;
      }
      if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
        throw new Error("A competing profile mutation must not start");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(profileFacts()));
    const form = directFactForm(container);
    await act(async () => fillDirectFact(form, "single_flight_create", "Synthetic value"));
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      buttonNamed(container, `Confirm ${proposal.key}`).click();
    });

    const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method !== undefined);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.[0]).toBe("/api/platform/profile-facts");
    expect(mutations[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        kind: "skill",
        key: "single_flight_create",
        value: "Synthetic value",
        sensitivity: "confidential",
      }),
    });
    expect(new Headers(mutations[0]?.[1]?.headers).get("idempotency-key")).toMatch(
      /^profile-fact-/,
    );
    expect(createSignal?.aborted).toBe(false);

    await act(async () =>
      pendingCreate.resolve(jsonResponse(confirmedDirectFact("single_flight_create"))),
    );
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(createSignal?.aborted).toBe(false);
  });

  it("reuses an ambiguous create intent and rotates it after a definitive rejection", async () => {
    vi.useFakeTimers();
    const stalled = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let createCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyFacts);
      }
      if (path === "/api/platform/profile-facts" && init?.method === "POST") {
        mutationCalls.push(init);
        createCount += 1;
        if (createCount === 1) return stalled.promise;
        if (createCount === 2) {
          return jsonResponse({ code: "invalid_request", detail: privateProblemCanary }, 400);
        }
        return jsonResponse(confirmedDirectFact("ambiguous_create"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(profileFacts()));
    const form = directFactForm(container);
    await act(async () => fillDirectFact(form, "ambiguous_create", "Synthetic value"));
    const submit = () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await act(async () => submit());
    const firstSignal = mutationCalls[0]?.signal;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(firstSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Saving timed out. Retry to safely check the same profile fact.",
    );

    await act(async () => submit());
    expect(container.textContent).toContain("Check the profile fact and try again.");
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[1]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[1]?.headers).get("idempotency-key")).toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );

    await act(async () => submit());
    expect(mutationCalls).toHaveLength(3);
    expect(mutationCalls[2]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[2]?.headers).get("idempotency-key")).not.toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
    await act(async () => stalled.resolve(jsonResponse(confirmedDirectFact("stale_create"))));
    expect(container.textContent).not.toContain("stale_create");
  });

  it("keeps competing profile reviews single-flight and reuses an ambiguous update intent", async () => {
    vi.useFakeTimers();
    const proposal = proposedFact("ambiguous_review");
    const stalled = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let patchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
        }
        if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
          mutationCalls.push(init);
          patchCount += 1;
          return patchCount === 1
            ? stalled.promise
            : jsonResponse({ ...proposal, verification: "confirmed", version: 2 });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => {
      buttonNamed(container, `Confirm ${proposal.key}`).click();
      buttonNamed(container, `Reject ${proposal.key}`).click();
    });
    expect(mutationCalls).toHaveLength(1);
    expect(JSON.parse(String(mutationCalls[0]?.body))).toEqual({
      expectedVersion: 1,
      verification: "confirmed",
    });

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(mutationCalls[0]?.signal?.aborted).toBe(true);
    expect(container.textContent).toContain("Saving timed out");
    await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[1]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[1]?.headers).get("idempotency-key")).toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain("Prior versions remain auditable");
    await act(async () =>
      stalled.resolve(jsonResponse({ ...proposal, verification: "rejected", version: 2 })),
    );
    expect(container.textContent).not.toContain("rejected · version 2");
  });

  it("prevents a stale session completion from clearing the next session's ambiguous intent", async () => {
    const staleCreate = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let createCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          mutationCalls.push(init);
          createCount += 1;
          if (createCount === 1) return staleCreate.promise;
          if (createCount === 2) throw new TypeError(privateProblemCanary);
          return jsonResponse(confirmedDirectFact("session_b_fact"));
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    let form = directFactForm(container);
    await act(async () => fillDirectFact(form, "same_session_fact", "Synthetic value"));
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const sessionAKey = new Headers(mutationCalls[0]?.headers).get("idempotency-key");

    await act(async () => root.render(profileFacts(false)));
    expect(mutationCalls[0]?.signal?.aborted).toBe(true);
    await act(async () => root.render(profileFacts()));
    form = directFactForm(container);
    await act(async () => fillDirectFact(form, "same_session_fact", "Synthetic value"));
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    const sessionBKey = new Headers(mutationCalls[1]?.headers).get("idempotency-key");
    expect(sessionBKey).not.toBe(sessionAKey);

    await act(async () =>
      staleCreate.resolve(jsonResponse(confirmedDirectFact("stale_session_a_fact"))),
    );
    expect(container.textContent).not.toContain("stale_session_a_fact");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(new Headers(mutationCalls[2]?.headers).get("idempotency-key")).toBe(sessionBKey);
    expect(mutationCalls[2]?.body).toBe(mutationCalls[1]?.body);
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
  });

  it("keeps the fixed profile conflict flow and reloads the latest fact", async () => {
    const proposal = proposedFact("conflicting_skill");
    const latest = { ...proposal, value: "Latest synthetic value", version: 2 };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          const fact = reads === 1 ? proposal : latest;
          return jsonResponse({ facts: [fact], confirmedCount: 0, proposedCount: 1 });
        }
        if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
          return jsonResponse(
            {
              code: "profile_fact_transition_conflict",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            409,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());

    expect(reads).toBe(2);
    expect(container.textContent).toContain(
      "This proposal changed after it was loaded. The latest version is shown; review it again.",
    );
    expect(container.textContent).toContain("Latest synthetic value");
    expect(container.textContent).not.toContain(privateProblemCanary);
  });

  it("does not restore a created fact after sign-out during its POST", async () => {
    const pendingCreate = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          return pendingCreate.promise;
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "prior_account_created",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Prior account value",
      );
    });
    await act(async () =>
      factForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    await act(async () => root.render(profileFacts(false)));
    expect(container.textContent).not.toContain("prior_account_created");
    expect(container.querySelector("form")).toBeNull();
    await act(async () =>
      pendingCreate.resolve(
        jsonResponse({
          ...proposedFact("prior_account_created"),
          verification: "confirmed",
          source: { type: "user", reference: "direct-entry" },
        }),
      ),
    );

    expect(container.textContent).not.toContain("prior_account_created");
    expect(container.textContent).not.toContain("Profile fact saved");
    expect(container.querySelector("form")).toBeNull();
  });

  it("clears an open correction when the user signs out", async () => {
    const proposal = proposedFact();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 }),
      ),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => buttonNamed(container, "Edit & confirm").click());
    expect(
      labelledControl<HTMLInputElement>(container, `Correct ${proposal.key}`, "input").value,
    ).toBe("Prior account value");

    await act(async () => root.render(profileFacts(false)));
    expect(container.textContent).not.toContain(`Correct ${proposal.key}`);
    expect(container.textContent).not.toContain(proposal.key);
  });

  it.each(["confirm", "edit-confirm", "reject"] as const)(
    "does not apply a stale %s PATCH after sign-out",
    async (action) => {
      const proposal = proposedFact();
      const pendingPatch = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const path = requestPath(input);
          if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
            return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
          }
          if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
            return pendingPatch.promise;
          }
          throw new Error(`Unexpected request: ${path}`);
        }),
      );

      await act(async () => root.render(profileFacts()));
      if (action === "confirm") {
        await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());
      } else if (action === "reject") {
        await act(async () => buttonNamed(container, `Reject ${proposal.key}`).click());
      } else {
        await act(async () => buttonNamed(container, "Edit & confirm").click());
        const correction = labelledControl<HTMLInputElement>(
          container,
          `Correct ${proposal.key}`,
          "input",
        );
        await act(async () => setControlValue(correction, "Corrected prior account value"));
        const correctionForm = correction.closest("form");
        await act(async () =>
          correctionForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      }

      await act(async () => root.render(profileFacts(false)));
      await act(async () =>
        pendingPatch.resolve(
          jsonResponse({
            ...proposal,
            value: action === "edit-confirm" ? "Corrected prior account value" : proposal.value,
            verification: action === "reject" ? "rejected" : "confirmed",
            version: 2,
          }),
        ),
      );

      expect(container.textContent).not.toContain(proposal.key);
      expect(container.textContent).not.toContain("Prior versions remain auditable");
    },
  );

  it("requires an explicit fact category and fixes direct entries to confidential", async () => {
    let submittedFact: unknown;
    const created: ProfileFact = {
      id: "019c0000-0000-7000-8000-000000000031",
      kind: "skill",
      key: "programming_language",
      value: "Synthetic TypeScript",
      verification: "confirmed",
      sensitivity: "confidential",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences") {
          return jsonResponse({ title: "Not found" }, 404);
        }
        if (path === "/api/platform/resumes") return jsonResponse(emptyResumes);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          submittedFact = JSON.parse(String(init.body));
          return jsonResponse(created);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(foundation()));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    const submit = factForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(labelledControl<HTMLSelectElement>(factForm, "Fact category", "select").value).toBe("");
    expect(factForm.textContent).toContain(
      "Restricted sponsorship, work-authorization, demographic, disability, veteran, and legal answers are not collected here",
    );
    expect(submit?.disabled).toBe(true);

    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "programming_language",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Synthetic TypeScript",
      );
    });
    await act(async () =>
      factForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(submittedFact).toEqual({
      kind: "skill",
      key: "programming_language",
      value: "Synthetic TypeScript",
      sensitivity: "confidential",
    });
  });

  it("shows fixed candidate-safe copy for resume list and registration failures", async () => {
    let reads = 0;
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          return reads === 1
            ? jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              )
            : jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse(
            {
              code: "document_intake_unavailable",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(resumeUpload()));
    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => root.render(resumeUpload(false)));
    await act(async () => root.render(resumeUpload()));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(registrationCalls).toBe(1));
    });

    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(container.textContent).toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(false);
  });

  it("shows fixed candidate-safe copy when resume status polling fails", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        return reads === 1
          ? jsonResponse({ documents: [resumeDocument()] })
          : jsonResponse(
              {
                code: "private_database_failure",
                title: privateProblemCanary,
                detail: privateProblemCanary,
              },
              503,
            );
      }),
    );

    await act(async () => root.render(resumeUpload()));
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(reads).toBe(2);
    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);
  });

  it("hides resume state immediately and ignores an initial load after sign-out", async () => {
    const pendingLoad = deferred<Response>();
    const parsedCallback = vi.fn();
    let loadSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        loadSignal = init?.signal;
        return pendingLoad.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    await act(async () => root.render(resumeUpload(false, parsedCallback)));

    expect(loadSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingLoad.resolve(jsonResponse({ documents: [resumeDocument("parsed")] })),
    );
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("hides resume state immediately and ignores a poll after sign-out", async () => {
    vi.useFakeTimers();
    const pendingPoll = deferred<Response>();
    const parsedCallback = vi.fn();
    let reads = 0;
    let pollSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        reads += 1;
        if (reads === 1) return jsonResponse({ documents: [resumeDocument()] });
        pollSignal = init?.signal;
        return pendingPoll.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(2);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));

    expect(pollSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingPoll.resolve(jsonResponse({ documents: [resumeDocument("parsed")] })),
    );
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("cancels the resume poll delay before another account-bound request", async () => {
    vi.useFakeTimers();
    const parsedCallback = vi.fn();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        return jsonResponse({ documents: [resumeDocument()] });
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(reads).toBe(1);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(reads).toBe(1);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("keeps a new account poll active when the prior account poll resolves last", async () => {
    vi.useFakeTimers();
    const pendingPriorPoll = deferred<Response>();
    const parsedCallback = vi.fn();
    const priorDocument = resumeDocument();
    const currentDocument: ResumeDocument = {
      ...resumeDocument(),
      id: "019c0000-0000-7000-8000-000000000091",
      fileName: "synthetic-current-account.pdf",
    };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        if (reads === 1) return jsonResponse({ documents: [priorDocument] });
        if (reads === 2) return pendingPriorPoll.promise;
        if (reads === 3) return jsonResponse({ documents: [currentDocument] });
        if (reads === 4) {
          return jsonResponse({ documents: [{ ...currentDocument, status: "parsed" }] });
        }
        throw new Error(`Unexpected resume read ${reads}`);
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(2);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(container.textContent).toContain("synthetic-current-account.pdf");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(4);
    expect(container.textContent).toContain("Resume parsing finished");
    expect(parsedCallback).toHaveBeenCalledTimes(1);

    await act(async () =>
      pendingPriorPoll.resolve(
        jsonResponse({ documents: [{ ...priorDocument, status: "parsed" }] }),
      ),
    );
    expect(container.textContent).toContain("synthetic-current-account.pdf");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(parsedCallback).toHaveBeenCalledTimes(1);
  });

  it("does not continue a resume upload after sign-out during registration", async () => {
    const pendingRegistration = deferred<Response>();
    const parsedCallback = vi.fn();
    let registrationSignal: AbortSignal | null | undefined;
    let storageCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationSignal = init.signal;
          return pendingRegistration.promise;
        }
        storageCalls += 1;
        return new Response(null, { status: 204 });
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(registrationSignal).toBeTruthy());
    });

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(registrationSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingRegistration.resolve(
        jsonResponse({
          document: resumeDocument("awaiting_upload"),
          upload: {
            url: "https://storage.example.test/upload",
            method: "POST",
            fields: { key: "synthetic/key" },
            expiresAt: "2026-08-15T12:15:00.000Z",
          },
        }),
      ),
    );
    expect(storageCalls).toBe(0);
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("does not register a resume when sign-out occurs during hashing", async () => {
    const pendingBytes = deferred<ArrayBuffer>();
    const parsedCallback = vi.fn();
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse({ title: "Unexpected registration" }, 500);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: () => pendingBytes.promise,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () =>
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(fileInput.value).toBe("");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () => pendingBytes.resolve(new Uint8Array([1, 2, 3]).buffer));
    expect(registrationCalls).toBe(0);
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("does not restore resume state after sign-out during the storage upload", async () => {
    const pendingStorage = deferred<Response>();
    const parsedCallback = vi.fn();
    let storageSignal: AbortSignal | null | undefined;
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse({
            document: resumeDocument("awaiting_upload"),
            upload: {
              url: "https://storage.example.test/upload",
              method: "POST",
              fields: { key: "synthetic/key" },
              expiresAt: "2026-08-15T12:15:00.000Z",
            },
          });
        }
        storageSignal = init?.signal;
        return pendingStorage.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(storageSignal).toBeTruthy());
    });
    expect(registrationCalls).toBe(1);

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(storageSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () => pendingStorage.resolve(new Response(null, { status: 204 })));
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });
});
