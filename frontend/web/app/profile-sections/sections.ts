import type {
  ProfileApplicationAnswer,
  ProfileEducationEntry,
  ProfileSkillEntry,
  ProfileWorkExperienceEntry,
} from "@ai-job-apply/api-contracts";
import { DEGREE_OPTIONS, FIELD_OF_STUDY_OPTIONS } from "../../lib/education-options";

export type ProfileEntryRecord =
  | ProfileEducationEntry
  | ProfileWorkExperienceEntry
  | ProfileSkillEntry
  | ProfileApplicationAnswer;

export type FieldType = "text" | "textarea" | "date" | "bullets" | "select";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  maxLength: number;
  help?: string;
  /** The choices of a select field. */
  options?: readonly string[];
}

export type SectionKey = "education" | "workExperience" | "skill" | "applicationAnswer";

export interface ProfileSectionConfig {
  key: SectionKey;
  path: "education-entries" | "work-experience-entries" | "skill-entries" | "application-answers";
  title: string;
  singular: string;
  collectionKey: "entries" | "answers";
  ordered: boolean;
  limit: number;
  fields: readonly FieldConfig[];
  empty: string;
  summary(record: Record<string, unknown>): { primary: string; secondary?: string };
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function dateRange(record: Record<string, unknown>): string {
  const start = text(record.startDate);
  const end = text(record.endDate);
  if (!start && !end) return "";
  return `${start || "?"} to ${end || "present"}`;
}

export const PROFILE_SECTIONS: Readonly<Record<SectionKey, ProfileSectionConfig>> = {
  education: {
    key: "education",
    path: "education-entries",
    title: "Education",
    singular: "education entry",
    collectionKey: "entries",
    ordered: true,
    limit: 20,
    empty: "No education saved yet.",
    fields: [
      { name: "school", label: "School", type: "text", required: true, maxLength: 200 },
      { name: "degree", label: "Degree", type: "select", options: DEGREE_OPTIONS, maxLength: 200 },
      {
        name: "fieldOfStudy",
        label: "Field of study",
        type: "select",
        options: FIELD_OF_STUDY_OPTIONS,
        maxLength: 200,
      },
      { name: "startDate", label: "Start date", type: "date", maxLength: 10 },
      { name: "endDate", label: "End date", type: "date", maxLength: 10 },
    ],
    summary: (record) => ({
      primary: text(record.school),
      secondary: [text(record.degree), text(record.fieldOfStudy), dateRange(record)]
        .filter(Boolean)
        .join(" - "),
    }),
  },
  workExperience: {
    key: "workExperience",
    path: "work-experience-entries",
    title: "Work experience",
    singular: "job",
    collectionKey: "entries",
    ordered: true,
    limit: 30,
    empty: "No work experience saved yet.",
    fields: [
      { name: "company", label: "Company", type: "text", required: true, maxLength: 200 },
      { name: "title", label: "Job title", type: "text", required: true, maxLength: 200 },
      { name: "location", label: "Location", type: "text", maxLength: 200 },
      { name: "startDate", label: "Start date", type: "date", required: true, maxLength: 10 },
      {
        name: "endDate",
        label: "End date",
        type: "date",
        maxLength: 10,
        help: "Leave empty if this is your current job.",
      },
      {
        name: "bullets",
        label: "Achievements",
        type: "bullets",
        maxLength: 500,
        help: "One per line, up to 20 lines of 500 characters.",
      },
    ],
    summary: (record) => ({
      primary: [text(record.title), text(record.company)].filter(Boolean).join(" at "),
      secondary: dateRange(record),
    }),
  },
  skill: {
    key: "skill",
    path: "skill-entries",
    title: "Skills",
    singular: "skill",
    collectionKey: "entries",
    ordered: true,
    limit: 100,
    empty: "No skills saved yet.",
    fields: [
      { name: "name", label: "Skill", type: "text", required: true, maxLength: 100 },
      { name: "category", label: "Category", type: "text", maxLength: 60 },
    ],
    summary: (record) => ({ primary: text(record.name), secondary: text(record.category) }),
  },
  applicationAnswer: {
    key: "applicationAnswer",
    path: "application-answers",
    title: "Application answers",
    singular: "answer",
    collectionKey: "answers",
    ordered: false,
    limit: 200,
    empty: "No reusable answers saved yet.",
    fields: [
      {
        name: "question",
        label: "Question",
        type: "text",
        required: true,
        maxLength: 300,
        help: "Reused only when a form asks exactly this question.",
      },
      { name: "answer", label: "Answer", type: "textarea", required: true, maxLength: 2000 },
    ],
    summary: (record) => ({ primary: text(record.question), secondary: text(record.answer) }),
  },
};

export type FormValues = Record<string, string>;

export function emptyValues(section: ProfileSectionConfig): FormValues {
  return Object.fromEntries(section.fields.map((field) => [field.name, ""]));
}

/** Form values for a saved record or a draft's values. */
export function valuesFrom(
  section: ProfileSectionConfig,
  source: Record<string, unknown>,
): FormValues {
  return Object.fromEntries(
    section.fields.map((field) => {
      const value = source[field.name];
      if (field.type === "bullets") {
        const lines = Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
        return [field.name, lines.join("\n")];
      }
      return [field.name, typeof value === "string" ? value : ""];
    }),
  );
}

function bulletLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The first problem a candidate can fix before sending, or undefined. */
export function validateValues(
  section: ProfileSectionConfig,
  values: FormValues,
): string | undefined {
  for (const field of section.fields) {
    const value = values[field.name] ?? "";
    if (field.required && !value.trim()) return `${field.label} is required.`;
    if (field.type === "bullets") {
      const lines = bulletLines(value);
      if (lines.length > 20) return "Add at most 20 achievements.";
      if (lines.some((line) => line.length > field.maxLength)) {
        return `Keep each achievement under ${field.maxLength + 1} characters.`;
      }
    } else if (value.length > field.maxLength) {
      return `${field.label} is too long.`;
    }
  }
  const start = values.startDate ?? "";
  const end = values.endDate ?? "";
  if (start && end && end < start) return "The end date cannot be before the start date.";
  return undefined;
}

function fieldValue(field: FieldConfig, value: string): string | string[] | undefined {
  if (field.type === "bullets") {
    const lines = bulletLines(value);
    return lines.length > 0 ? lines : undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Create body: every filled field. */
export function createBody(
  section: ProfileSectionConfig,
  values: FormValues,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of section.fields) {
    const value = fieldValue(field, values[field.name] ?? "");
    if (value !== undefined) body[field.name] = value;
  }
  return body;
}

/** Update body: only what changed; a cleared optional field becomes null. */
export function patchBody(
  section: ProfileSectionConfig,
  record: Record<string, unknown>,
  values: FormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of section.fields) {
    const next = fieldValue(field, values[field.name] ?? "");
    const before = record[field.name];
    const same = JSON.stringify(next ?? null) === JSON.stringify(before ?? null);
    if (same) continue;
    patch[field.name] = next === undefined ? null : next;
  }
  return patch;
}
