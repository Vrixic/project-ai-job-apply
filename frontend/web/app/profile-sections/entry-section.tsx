"use client";

import type { ProfileImportDraft } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEntry,
  deleteEntry,
  discardDraft,
  loadEntries,
  ProfileSectionRequestError,
  reorderEntries,
  saveDraft,
  updateEntry,
} from "./api";
import { EntryForm } from "./entry-form";
import {
  createBody,
  emptyValues,
  type FormValues,
  patchBody,
  type ProfileEntryRecord,
  type ProfileSectionConfig,
  valuesFrom,
} from "./sections";

type Editing =
  | { kind: "new" }
  | { kind: "record"; record: ProfileEntryRecord }
  | { kind: "draft"; draft: ProfileImportDraft };

function errorText(error: unknown): string {
  return error instanceof ProfileSectionRequestError
    ? error.message
    : "Your profile is temporarily unavailable.";
}

/** Saved entries of one Profile section, with add, edit, delete, reorder and resume-import review. */
export function EntrySection({
  section,
  authenticated,
  drafts,
  onDraftsChanged,
}: {
  section: ProfileSectionConfig;
  authenticated: boolean;
  drafts: readonly ProfileImportDraft[];
  onDraftsChanged: () => void;
}) {
  const [entries, setEntries] = useState<ProfileEntryRecord[]>([]);
  const [loading, setLoading] = useState(authenticated);
  const [editing, setEditing] = useState<Editing>();
  const [confirmingDelete, setConfirmingDelete] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadEntries(section);
      if (mounted.current) {
        setEntries(loaded);
        setMessage(undefined);
      }
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    if (!authenticated) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [authenticated, refresh]);

  async function run(action: () => Promise<void>, failureStaysInForm = false) {
    setBusy(true);
    setMessage(undefined);
    setFormError(undefined);
    try {
      await action();
    } catch (error) {
      if (!mounted.current) return;
      if (failureStaysInForm) setFormError(errorText(error));
      else setMessage(errorText(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function submit(values: FormValues) {
    const current = editing;
    if (!current) return;
    void run(async () => {
      if (current.kind === "new") {
        await createEntry(section, createBody(section, values));
        setMessage(`Saved ${section.singular}.`);
      } else if (current.kind === "record") {
        const patch = patchBody(
          section,
          current.record as unknown as Record<string, unknown>,
          values,
        );
        if (Object.keys(patch).length > 0) await updateEntry(section, current.record, patch);
        setMessage(`Saved ${section.singular}.`);
      } else {
        await saveDraft(current.draft.id, { values: createBody(section, values) });
        onDraftsChanged();
        setMessage(`Saved ${section.singular} from your resume.`);
      }
      if (!mounted.current) return;
      setEditing(undefined);
      await refresh();
    }, true);
  }

  function remove(record: ProfileEntryRecord) {
    void run(async () => {
      await deleteEntry(section, record);
      setConfirmingDelete(undefined);
      setMessage(`Deleted ${section.singular}.`);
      await refresh();
    });
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= entries.length) return;
    const ids = entries.map((entry) => entry.id);
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    void run(async () => {
      const reordered = await reorderEntries(section, ids);
      if (mounted.current) setEntries(reordered);
    });
  }

  function saveAsIs(draft: ProfileImportDraft) {
    void run(async () => {
      await saveDraft(draft.id, {});
      onDraftsChanged();
      setMessage(`Saved ${section.singular} from your resume.`);
      await refresh();
    });
  }

  function discard(draft: ProfileImportDraft) {
    void run(async () => {
      await discardDraft(draft.id);
      onDraftsChanged();
      setMessage("Removed the imported suggestion.");
    });
  }

  if (!authenticated) return null;
  const full = entries.length >= section.limit;

  return (
    <section aria-labelledby={`profile-${section.key}-heading`}>
      <div className="section-heading">
        <div>
          <h2 id={`profile-${section.key}-heading`}>{section.title}</h2>
        </div>
        <span>{entries.length} saved</span>
      </div>

      {drafts.length > 0 && (
        <section className="profile-drafts" aria-label={`${section.title} found in your resume`}>
          <h3>Found in your resume</h3>
          <p className="field-help">
            These are suggestions. Nothing is part of your profile until you save it.
          </p>
          <ul>
            {drafts.map((draft) => {
              const summary = section.summary(draft.values as Record<string, unknown>);
              return (
                <li className="profile-entry" key={draft.id}>
                  <div>
                    <strong>{summary.primary || `Untitled ${section.singular}`}</strong>
                    {summary.secondary && <span>{summary.secondary}</span>}
                  </div>
                  <div className="profile-entry-actions">
                    <button type="button" onClick={() => saveAsIs(draft)} disabled={busy || full}>
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormError(undefined);
                        setEditing({ kind: "draft", draft });
                      }}
                      disabled={busy || full}
                    >
                      Edit and save
                    </button>
                    <button type="button" onClick={() => discard(draft)} disabled={busy}>
                      Discard
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {loading ? (
        <p>Loading {section.title.toLowerCase()}…</p>
      ) : entries.length === 0 ? (
        <p>{section.empty}</p>
      ) : (
        <ul className="profile-entry-list">
          {entries.map((entry, index) => {
            const summary = section.summary(entry as unknown as Record<string, unknown>);
            return (
              <li className="profile-entry" key={entry.id}>
                <div>
                  <strong>{summary.primary}</strong>
                  {summary.secondary && <span>{summary.secondary}</span>}
                </div>
                <div className="profile-entry-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${summary.primary}`}
                    onClick={() => {
                      setFormError(undefined);
                      setEditing({ kind: "record", record: entry });
                    }}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  {section.ordered && (
                    <>
                      <button
                        type="button"
                        aria-label={`Move ${summary.primary} up`}
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${summary.primary} down`}
                        onClick={() => move(index, 1)}
                        disabled={busy || index === entries.length - 1}
                      >
                        Down
                      </button>
                    </>
                  )}
                  {confirmingDelete === entry.id ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Confirm delete ${summary.primary}`}
                        onClick={() => remove(entry)}
                        disabled={busy}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(undefined)}
                        disabled={busy}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${summary.primary}`}
                      onClick={() => setConfirmingDelete(entry.id)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <EntryForm
          section={section}
          initialValues={
            editing.kind === "record"
              ? valuesFrom(section, editing.record as unknown as Record<string, unknown>)
              : editing.kind === "draft"
                ? valuesFrom(section, editing.draft.values as Record<string, unknown>)
                : emptyValues(section)
          }
          submitLabel={editing.kind === "new" ? `Add ${section.singular}` : "Save"}
          busy={busy}
          error={formError}
          onSubmit={submit}
          onCancel={() => setEditing(undefined)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setFormError(undefined);
            setEditing({ kind: "new" });
          }}
          disabled={busy || full || loading}
        >
          Add {section.singular}
        </button>
      )}
      {full && <p className="field-help">This section is full. Delete an entry to add another.</p>}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
