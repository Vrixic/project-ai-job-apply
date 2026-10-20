import type { ApplicationResumePreview } from "@ai-job-apply/api-contracts";

const CHANGE_LABEL = {
  kept: "Kept",
  moved_up: "Moved up",
  omitted: "Left out for this job",
} as const;

/** Stable keys for a static list whose texts may repeat: the text plus its occurrence number. */
export function keyed<T>(
  items: readonly T[],
  textOf: (item: T) => string,
): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { key: `${text}#${count}`, item };
  });
}

const UNAVAILABLE_COPY: Readonly<Record<string, string>> = {
  document_unreadable:
    "We could not read your resume right now. Try again, or upload it again from your profile.",
  factuality_failed: "We could not tailor your resume safely, so none is attached.",
  render_failed: "We could not build a file from your tailored resume, so none is attached.",
  service_unavailable: "Resume tailoring is temporarily unavailable. Try again shortly.",
};

/**
 * Shows the resume prepared for one application: which of the candidate's own bullets were kept,
 * moved up, or left out. It never shows generated wording, and it only displays what the platform
 * returned for this signed-in owner. Text is rendered inert.
 */
export function ResumePreviewView({ preview }: { preview: ApplicationResumePreview }) {
  if (preview.status === "no_resume") {
    return (
      <p>
        You have not added a resume yet, so none is attached. Add one in your profile, then generate
        again.
      </p>
    );
  }
  if (preview.status === "unavailable") {
    return (
      <p role="alert">
        {UNAVAILABLE_COPY[preview.unavailableReason ?? "service_unavailable"] ??
          UNAVAILABLE_COPY.service_unavailable}
      </p>
    );
  }
  return (
    <div className="resume-preview">
      <p>
        {preview.baseDocument?.fileName ? (
          <>
            Built from <strong>{preview.baseDocument.fileName}</strong>.{" "}
          </>
        ) : null}
        We only reorder and trim your own bullets to match this job. We never add or reword
        anything.
      </p>
      {preview.matchedTerms && preview.matchedTerms.length > 0 ? (
        <p>Matches to this job found in your resume: {preview.matchedTerms.join(", ")}.</p>
      ) : null}
      {keyed(preview.sections ?? [], (section) => `${section.kind}:${section.heading ?? ""}`).map(
        ({ key: sectionKey, item: section }) => (
          <div key={sectionKey}>
            {section.heading ? <h4>{section.heading}</h4> : null}
            {keyed(section.entries, (entry) => entry.lines.join("|")).map(
              ({ key: entryKey, item: entry }) => (
                <div key={entryKey}>
                  {keyed(entry.lines, (line) => line).map(({ key: lineKey, item: line }) => (
                    <p key={lineKey}>{line}</p>
                  ))}
                  {entry.bullets.length > 0 ? (
                    <ul>
                      {keyed(entry.bullets, (bullet) => bullet.text).map(
                        ({ key: bulletKey, item: bullet }) => (
                          <li key={bulletKey}>
                            <span>{bullet.text}</span>{" "}
                            <strong>({CHANGE_LABEL[bullet.change]})</strong>
                            {bullet.matchedTerms && bullet.matchedTerms.length > 0 ? (
                              <span> Matches: {bullet.matchedTerms.join(", ")}.</span>
                            ) : null}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ),
            )}
          </div>
        ),
      )}
    </div>
  );
}
