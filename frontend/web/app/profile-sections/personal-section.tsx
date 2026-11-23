"use client";

import type { ProfileImportDraft, ProfilePersonal } from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { countries } from "../../lib/countries";
import {
  LANGUAGE_OPTIONS,
  OTHER,
  PRONOUN_OPTIONS,
  regionOptions,
  withSaved,
} from "../../lib/profile-options";
import {
  discardDraft,
  loadPersonal,
  ProfileSectionRequestError,
  saveDraft,
  savePersonal,
} from "./api";

type LinkKind = "linkedin" | "github" | "portfolio" | "x" | "other";
const LINK_FIELDS: ReadonlyArray<{ kind: LinkKind; label: string }> = [
  { kind: "linkedin", label: "LinkedIn address" },
  { kind: "github", label: "GitHub address" },
  { kind: "portfolio", label: "Portfolio address" },
  { kind: "x", label: "X (Twitter) address" },
  { kind: "other", label: "Personal website or other link" },
];
type Proficiency = "native" | "fluent" | "professional" | "conversational" | "basic";
const PROFICIENCIES: ReadonlyArray<{ value: Proficiency; label: string }> = [
  { value: "native", label: "Native" },
  { value: "fluent", label: "Fluent" },
  { value: "professional", label: "Professional working" },
  { value: "conversational", label: "Conversational" },
  { value: "basic", label: "Basic" },
];
const MAXIMUM_LANGUAGES = 20;
const ADDRESS_FIELDS: ReadonlyArray<{
  name: "street" | "city" | "region" | "postalCode" | "country";
  label: string;
  maxLength: number;
  help?: string;
}> = [
  { name: "country", label: "Country", maxLength: 2 },
  { name: "street", label: "Street address", maxLength: 200 },
  { name: "city", label: "City", maxLength: 120 },
  { name: "region", label: "State or region", maxLength: 120 },
  { name: "postalCode", label: "Postal code", maxLength: 32 },
];
const PRONOUN_CHOICES: readonly string[] = PRONOUN_OPTIONS;

interface PersonalValues {
  fullName: string;
  email: string;
  phone: string;
  address: Record<(typeof ADDRESS_FIELDS)[number]["name"], string>;
  links: Record<LinkKind, string>;
  pronouns: string;
  languages: Array<{ language: string; proficiency: Proficiency }>;
}

type Source = Partial<{
  fullName: string;
  email: string;
  phone: string;
  address: Partial<Record<string, string>>;
  links: Array<{ kind: LinkKind; url: string }>;
  pronouns: string;
  languages: Array<{ language: string; proficiency: Proficiency }>;
}>;

function toValues(
  source: Source | undefined,
  fallback?: { name?: string | undefined; email?: string | undefined },
): PersonalValues {
  const links: Record<LinkKind, string> = {
    linkedin: "",
    github: "",
    portfolio: "",
    x: "",
    other: "",
  };
  for (const link of source?.links ?? []) links[link.kind] ||= link.url;
  return {
    fullName: source?.fullName ?? (source ? "" : (fallback?.name ?? "")),
    email: source?.email ?? (source ? "" : (fallback?.email ?? "")),
    phone: source?.phone ?? "",
    address: {
      street: source?.address?.street ?? "",
      city: source?.address?.city ?? "",
      region: source?.address?.region ?? "",
      postalCode: source?.address?.postalCode ?? "",
      country: (source?.address?.country ?? "").toUpperCase(),
    },
    links,
    pronouns: source?.pronouns ?? "",
    languages: (source?.languages ?? []).map((entry) => ({ ...entry })),
  };
}

/** The whole record sent on save; fields left empty are cleared. */
function toFields(values: PersonalValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (values.fullName.trim()) fields.fullName = values.fullName.trim();
  if (values.email.trim()) fields.email = values.email.trim();
  if (values.phone.trim()) fields.phone = values.phone.trim();
  const address = Object.fromEntries(
    Object.entries(values.address)
      .map(([name, value]) => [
        name,
        name === "country" ? value.trim().toUpperCase() : value.trim(),
      ])
      .filter(([, value]) => value),
  );
  if (Object.keys(address).length > 0) fields.address = address;
  const links = LINK_FIELDS.map(({ kind }) => ({ kind, url: values.links[kind].trim() })).filter(
    (link) => link.url,
  );
  if (links.length > 0) fields.links = links;
  if (values.pronouns.trim()) fields.pronouns = values.pronouns.trim();
  const seen = new Set<string>();
  const languages = values.languages
    .map((entry) => ({ language: entry.language.trim(), proficiency: entry.proficiency }))
    .filter((entry) => {
      const key = entry.language.toLowerCase();
      if (!entry.language || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (languages.length > 0) fields.languages = languages;
  return fields;
}

function errorText(error: unknown): string {
  return error instanceof ProfileSectionRequestError
    ? error.message
    : "Your profile is temporarily unavailable.";
}

export function PersonalSection({
  authenticated,
  name,
  email,
  drafts,
  onDraftsChanged,
}: {
  authenticated: boolean;
  name?: string | undefined;
  email?: string | undefined;
  drafts: readonly ProfileImportDraft[];
  onDraftsChanged: () => void;
}) {
  const [saved, setSaved] = useState<ProfilePersonal>();
  const [values, setValues] = useState<PersonalValues>(() => toValues(undefined, { name, email }));
  const [reviewingDraft, setReviewingDraft] = useState<ProfileImportDraft>();
  const [loading, setLoading] = useState(authenticated);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pronounsOther, setPronounsOther] = useState(false);
  // A saved value that is not one of the choices is shown in the text box.
  const pronounsTyped =
    pronounsOther || (values.pronouns !== "" && !PRONOUN_CHOICES.includes(values.pronouns));
  const mounted = useRef(true);
  const idPrefix = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadPersonal();
      if (!mounted.current) return;
      setSaved(loaded);
      setValues(toValues(loaded as Source | undefined, { name, email }));
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [name, email]);

  useEffect(() => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [authenticated, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const fields = toFields(values);
      if (reviewingDraft) {
        await saveDraft(reviewingDraft.id, {
          values: fields,
          expectedPersonalVersion: saved?.version ?? 0,
        });
        setReviewingDraft(undefined);
        onDraftsChanged();
      } else {
        await savePersonal(saved?.version ?? 0, fields);
      }
      if (!mounted.current) return;
      setMessage("Saved your personal details.");
      await refresh();
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function discard(draft: ProfileImportDraft) {
    setBusy(true);
    try {
      await discardDraft(draft.id);
      if (reviewingDraft?.id === draft.id) {
        setReviewingDraft(undefined);
        setValues(toValues(saved as Source | undefined, { name, email }));
      }
      onDraftsChanged();
      setMessage("Removed the imported suggestion.");
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (!authenticated) return null;

  const field = (key: string) => `${idPrefix}-${key}`;

  return (
    <section aria-labelledby="profile-personal-heading">
      <div className="section-heading">
        <div>
          <h2 id="profile-personal-heading">Personal</h2>
        </div>
      </div>

      {drafts.map((draft) => (
        <section
          className="profile-drafts"
          aria-label="Personal details found in your resume"
          key={draft.id}
        >
          <h3>Found in your resume</h3>
          <p className="field-help">
            Review these details, then save. Nothing changes until you do.
          </p>
          <div className="profile-entry-actions">
            <button
              type="button"
              onClick={() => {
                setReviewingDraft(draft);
                setValues(toValues(draft.values as Source));
              }}
              disabled={busy}
            >
              Review and use these details
            </button>
            <button type="button" onClick={() => void discard(draft)} disabled={busy}>
              Discard
            </button>
          </div>
        </section>
      ))}

      {loading ? (
        <p>Loading your personal details…</p>
      ) : (
        <form className="profile-entry-form" aria-label="Personal details" onSubmit={submit}>
          <div className="profile-entry-field">
            <label htmlFor={field("fullName")}>Full name</label>
            <input
              id={field("fullName")}
              value={values.fullName}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setValues({ ...values, fullName: event.target.value })}
            />
          </div>
          <div className="profile-entry-field">
            <label htmlFor={field("email")}>Email</label>
            <input
              id={field("email")}
              type="email"
              value={values.email}
              maxLength={254}
              disabled={busy}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
          </div>
          <div className="profile-entry-field">
            <label htmlFor={field("phone")}>Phone</label>
            <input
              id={field("phone")}
              type="tel"
              value={values.phone}
              maxLength={40}
              disabled={busy}
              onChange={(event) => setValues({ ...values, phone: event.target.value })}
            />
          </div>
          <div className="profile-entry-field">
            <label htmlFor={field("pronouns")}>Pronouns</label>
            <span className="field-help">Optional.</span>
            <select
              id={field("pronouns")}
              value={pronounsTyped ? OTHER : values.pronouns}
              disabled={busy}
              onChange={(event) => {
                const choice = event.target.value;
                setPronounsOther(choice === OTHER);
                setValues({ ...values, pronouns: choice === OTHER ? "" : choice });
              }}
            >
              <option value="">Not answered</option>
              {PRONOUN_CHOICES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={OTHER}>Other</option>
            </select>
            {pronounsTyped && (
              <input
                aria-label="Your pronouns"
                value={values.pronouns}
                maxLength={40}
                disabled={busy}
                onChange={(event) => setValues({ ...values, pronouns: event.target.value })}
              />
            )}
          </div>
          <fieldset disabled={busy}>
            <legend>Address</legend>
            {ADDRESS_FIELDS.map((item) => {
              const setAddress = (value: string) =>
                setValues({ ...values, address: { ...values.address, [item.name]: value } });
              const regions =
                item.name === "region" ? regionOptions(values.address.country) : undefined;
              return (
                <div className="profile-entry-field" key={item.name}>
                  <label htmlFor={field(item.name)}>
                    {item.name === "region" && values.address.country === "CA"
                      ? "Province or territory"
                      : item.name === "region" && values.address.country === "US"
                        ? "State"
                        : item.label}
                  </label>
                  {item.name === "country" ? (
                    <select
                      id={field(item.name)}
                      value={values.address.country}
                      onChange={(event) => setAddress(event.target.value)}
                    >
                      <option value="">Choose a country</option>
                      {countries().map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  ) : regions ? (
                    <select
                      id={field(item.name)}
                      value={values.address.region}
                      onChange={(event) => setAddress(event.target.value)}
                    >
                      <option value="">Choose one</option>
                      {withSaved(regions, values.address.region).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={field(item.name)}
                      value={values.address[item.name]}
                      maxLength={item.maxLength}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Links</legend>
            {LINK_FIELDS.map((item) => (
              <div className="profile-entry-field" key={item.kind}>
                <label htmlFor={field(item.kind)}>{item.label}</label>
                <input
                  id={field(item.kind)}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={values.links[item.kind]}
                  maxLength={500}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      links: { ...values.links, [item.kind]: event.target.value },
                    })
                  }
                />
              </div>
            ))}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Languages you speak</legend>
            <span className="field-help">
              Used for questions such as "Are you fluent in French?".
            </span>
            {values.languages.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
              <div className="paired-fields" key={index}>
                <label>
                  Language
                  <select
                    value={entry.language}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        languages: values.languages.map((row, at) =>
                          at === index ? { ...row, language: event.target.value } : row,
                        ),
                      })
                    }
                  >
                    <option value="">Choose a language</option>
                    {withSaved(LANGUAGE_OPTIONS, entry.language).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Level
                  <select
                    value={entry.proficiency}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        languages: values.languages.map((row, at) =>
                          at === index
                            ? { ...row, proficiency: event.target.value as Proficiency }
                            : row,
                        ),
                      })
                    }
                  >
                    {PROFICIENCIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Remove ${entry.language || "this language"}`}
                  onClick={() =>
                    setValues({
                      ...values,
                      languages: values.languages.filter((_, at) => at !== index),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            {values.languages.length < MAXIMUM_LANGUAGES && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setValues({
                    ...values,
                    languages: [...values.languages, { language: "", proficiency: "fluent" }],
                  })
                }
              >
                Add a language
              </button>
            )}
          </fieldset>
          <div className="profile-entry-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : reviewingDraft ? "Save these details" : "Save personal details"}
            </button>
          </div>
        </form>
      )}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
