"use client";

import { type FormEvent, useId, useState } from "react";
import { type FormValues, type ProfileSectionConfig, validateValues } from "./sections";

/** One add or edit form for a Profile entry; the caller decides what saving means. */
export function EntryForm({
  section,
  initialValues,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  section: ProfileSectionConfig;
  initialValues: FormValues;
  submitLabel: string;
  busy: boolean;
  error?: string | undefined;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [localError, setLocalError] = useState<string>();
  const idPrefix = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateValues(section, values);
    setLocalError(problem);
    if (problem) return;
    onSubmit(values);
  }

  return (
    <form
      className="profile-entry-form"
      aria-label={`${submitLabel} ${section.singular}`}
      onSubmit={submit}
    >
      {section.fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const helpId = field.help ? `${id}-help` : undefined;
        const common = {
          id,
          name: field.name,
          value: values[field.name] ?? "",
          required: field.required === true,
          disabled: busy,
          "aria-describedby": helpId,
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
          ) => setValues((current) => ({ ...current, [field.name]: event.target.value })),
        };
        return (
          <div className="profile-entry-field" key={field.name}>
            <label htmlFor={id}>{field.label}</label>
            {field.help && (
              <span className="field-help" id={helpId}>
                {field.help}
              </span>
            )}
            {field.type === "select" ? (
              <select {...common}>
                <option value="">Choose…</option>
                {/* A value saved or imported before this list existed stays selectable. */}
                {common.value && !field.options?.includes(common.value) ? (
                  <option value={common.value}>{common.value} (saved)</option>
                ) : null}
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" || field.type === "bullets" ? (
              <textarea
                {...common}
                rows={field.type === "bullets" ? 6 : 4}
                maxLength={field.type === "bullets" ? undefined : field.maxLength}
              />
            ) : (
              <input
                {...common}
                type={field.type === "date" ? "date" : "text"}
                maxLength={field.maxLength}
              />
            )}
          </div>
        );
      })}
      {(localError ?? error) && <output role="alert">{localError ?? error}</output>}
      <div className="profile-entry-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
