import type { JobPreferenceSet, PutJobPreferencesRequest } from "@ai-job-apply/api-contracts";

export type WorkMode = PutJobPreferencesRequest["workModes"][number];
export type EmploymentType = PutJobPreferencesRequest["employmentTypes"][number];
export interface JobPreferenceFields {
  targetRoles: string[];
  locations: string[];
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  salaryMinimum: string;
  salaryCurrency: string;
  legacySponsorshipPresent: boolean;
}

export type JobPreferenceRequestResult =
  | { ok: true; request: PutJobPreferencesRequest }
  | { ok: false; message: string };

export function emptyJobPreferenceFields(): JobPreferenceFields {
  return {
    targetRoles: [""],
    locations: [],
    workModes: [],
    employmentTypes: [],
    salaryMinimum: "",
    salaryCurrency: "",
    legacySponsorshipPresent: false,
  };
}

export function hydrateJobPreferenceFields(preferences: JobPreferenceSet): JobPreferenceFields {
  return {
    targetRoles: [...preferences.targetRoles],
    locations: [...preferences.locations],
    workModes: [...preferences.workModes],
    employmentTypes: [...preferences.employmentTypes],
    salaryMinimum: preferences.salaryMinimum === undefined ? "" : String(preferences.salaryMinimum),
    salaryCurrency: preferences.salaryCurrency ?? "",
    legacySponsorshipPresent: Object.hasOwn(preferences, "requiresSponsorship"),
  };
}

export function normalizePreferenceValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

export function toggleOrderedChoice<T extends string>(
  options: readonly T[],
  selected: readonly T[],
  value: T,
  checked: boolean,
): T[] {
  const next = new Set(selected);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return options.filter((option) => next.has(option));
}

export function buildJobPreferenceRequest(fields: JobPreferenceFields): JobPreferenceRequestResult {
  if (fields.legacySponsorshipPresent) {
    return {
      ok: false,
      message:
        "These saved preferences contain a legacy sponsorship answer. Saving is unavailable until that answer moves to the restricted-data boundary.",
    };
  }

  const targetRoles = normalizePreferenceValues(fields.targetRoles);
  if (targetRoles.length === 0) {
    return { ok: false, message: "Add at least one target role." };
  }
  if (targetRoles.length > 10) {
    return { ok: false, message: "Save no more than ten target roles." };
  }
  const locations = normalizePreferenceValues(fields.locations);
  if (locations.length > 10) {
    return { ok: false, message: "Save no more than ten locations." };
  }
  if (fields.workModes.length === 0) {
    return { ok: false, message: "Select at least one work mode." };
  }
  if (fields.employmentTypes.length === 0) {
    return { ok: false, message: "Select at least one employment type." };
  }

  const salaryMinimum = fields.salaryMinimum.trim();
  const salaryCurrency = fields.salaryCurrency.trim().toUpperCase();
  if ((salaryMinimum.length === 0) !== (salaryCurrency.length === 0)) {
    return {
      ok: false,
      message: "Enter both a salary minimum and currency, or leave both blank.",
    };
  }

  let salary: Pick<PutJobPreferencesRequest, "salaryMinimum" | "salaryCurrency"> = {};
  if (salaryMinimum.length > 0) {
    if (!/^\d+$/.test(salaryMinimum) || !Number.isSafeInteger(Number(salaryMinimum))) {
      return {
        ok: false,
        message: "Salary minimum must be a non-negative whole number.",
      };
    }
    if (!/^[A-Z]{3}$/.test(salaryCurrency)) {
      return { ok: false, message: "Salary currency must be a three-letter code." };
    }
    salary = {
      salaryMinimum: Number(salaryMinimum),
      salaryCurrency,
    };
  }

  return {
    ok: true,
    request: {
      targetRoles,
      locations,
      workModes: [...fields.workModes],
      employmentTypes: [...fields.employmentTypes],
      ...salary,
    },
  };
}
