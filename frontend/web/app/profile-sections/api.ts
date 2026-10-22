import {
  compileComponentValidator,
  type ProfileEntryReference,
  type ProfileImportDraft,
  type ProfilePersonal,
} from "@ai-job-apply/api-contracts";
import { candidateSafeProblemMessage } from "../../lib/candidate-safe-problem";
import type { ProfileEntryRecord, ProfileSectionConfig } from "./sections";

const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const BASE = "/api/platform/profile";

export class ProfileSectionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProfileSectionRequestError";
  }
}

const validators = {
  personal: compileComponentValidator("ProfilePersonal"),
  drafts: compileComponentValidator("ProfileImportDraftCollection"),
  reference: compileComponentValidator("ProfileEntryReference"),
  education: compileComponentValidator("ProfileEducationEntryCollection"),
  workExperience: compileComponentValidator("ProfileWorkExperienceEntryCollection"),
  skill: compileComponentValidator("ProfileSkillEntryCollection"),
  applicationAnswer: compileComponentValidator("ProfileApplicationAnswerCollection"),
} as const;

const recordValidators = {
  education: compileComponentValidator("ProfileEducationEntry"),
  workExperience: compileComponentValidator("ProfileWorkExperienceEntry"),
  skill: compileComponentValidator("ProfileSkillEntry"),
  applicationAnswer: compileComponentValidator("ProfileApplicationAnswer"),
} as const;

const unavailable = "Your profile is temporarily unavailable.";

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      cache: "no-store",
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new ProfileSectionRequestError(unavailable, 0);
  }
  if (!response.ok) {
    throw new ProfileSectionRequestError(
      await candidateSafeProblemMessage(response, "profile_sections"),
      response.status,
    );
  }
  return response;
}

async function json<T>(response: Response, valid: (value: unknown) => boolean): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ProfileSectionRequestError(unavailable, response.status);
  }
  if (!valid(value)) throw new ProfileSectionRequestError(unavailable, response.status);
  return value as T;
}

const command = (): Record<string, string> => ({
  "idempotency-key": `profile-${crypto.randomUUID()}`,
});

/** The saved Personal record, or undefined until the candidate first saves it. */
export async function loadPersonal(): Promise<ProfilePersonal | undefined> {
  try {
    return await json<ProfilePersonal>(await send("/personal"), validators.personal);
  } catch (error) {
    if (error instanceof ProfileSectionRequestError && error.status === 404) return undefined;
    throw error;
  }
}

export async function savePersonal(
  expectedVersion: number,
  fields: Record<string, unknown>,
): Promise<ProfilePersonal> {
  const response = await send("/personal", {
    method: "PUT",
    headers: command(),
    body: JSON.stringify({ expectedVersion, ...fields }),
  });
  return json<ProfilePersonal>(response, validators.personal);
}

export async function loadEntries(section: ProfileSectionConfig): Promise<ProfileEntryRecord[]> {
  const response = await send(`/${section.path}`);
  const value = await json<Record<string, ProfileEntryRecord[]>>(response, validators[section.key]);
  return value[section.collectionKey] ?? [];
}

export async function createEntry(
  section: ProfileSectionConfig,
  fields: Record<string, unknown>,
): Promise<ProfileEntryRecord> {
  const response = await send(`/${section.path}`, {
    method: "POST",
    headers: command(),
    body: JSON.stringify(fields),
  });
  return json<ProfileEntryRecord>(response, recordValidators[section.key]);
}

export async function updateEntry(
  section: ProfileSectionConfig,
  record: ProfileEntryRecord,
  patch: Record<string, unknown>,
): Promise<ProfileEntryRecord> {
  const response = await send(`/${section.path}/${encodeURIComponent(record.id)}`, {
    method: "PATCH",
    headers: command(),
    body: JSON.stringify({ expectedVersion: record.version, ...patch }),
  });
  return json<ProfileEntryRecord>(response, recordValidators[section.key]);
}

export async function deleteEntry(
  section: ProfileSectionConfig,
  record: ProfileEntryRecord,
): Promise<void> {
  await send(
    `/${section.path}/${encodeURIComponent(record.id)}?expectedVersion=${record.version}`,
    {
      method: "DELETE",
      headers: command(),
    },
  );
}

export async function reorderEntries(
  section: ProfileSectionConfig,
  orderedEntryIds: readonly string[],
): Promise<ProfileEntryRecord[]> {
  const response = await send(`/${section.path}/reorder`, {
    method: "POST",
    headers: command(),
    body: JSON.stringify({ orderedEntryIds }),
  });
  const value = await json<Record<string, ProfileEntryRecord[]>>(response, validators[section.key]);
  return value[section.collectionKey] ?? [];
}

export async function loadDrafts(): Promise<ProfileImportDraft[]> {
  const value = await json<{ drafts: ProfileImportDraft[] }>(
    await send("/import-drafts"),
    validators.drafts,
  );
  return value.drafts;
}

export async function saveDraft(
  draftId: string,
  body: { values?: Record<string, unknown>; expectedPersonalVersion?: number },
): Promise<ProfileEntryReference> {
  const response = await send(`/import-drafts/${encodeURIComponent(draftId)}/save`, {
    method: "POST",
    headers: command(),
    body: JSON.stringify(body),
  });
  return json<ProfileEntryReference>(response, validators.reference);
}

export async function discardDraft(draftId: string): Promise<void> {
  await send(`/import-drafts/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
    headers: command(),
  });
}
