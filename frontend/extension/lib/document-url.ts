import { employerPageForSource } from "@ai-job-apply/ats-sdk/observed-form";

/**
 * Chrome reports `sender.url` as the address a document was created at. A board that moves between
 * its own tabs without a new document (Ashby: Overview, Application) leaves it on the tab the
 * candidate came from, while the page itself is already on the selected one. The document id binds
 * the sender to the selected document, and the executor reads that document's live address and
 * requires it to be exactly the selected one, so this only has to say whether the address the
 * document was created at is the same posting's page.
 */
export function sameDocumentPosting(selectedUrl: string, createdAt: string | undefined): boolean {
  if (createdAt === undefined) return false;
  return (
    employerPageForSource(createdAt, selectedUrl) !== undefined ||
    employerPageForSource(selectedUrl, createdAt) !== undefined
  );
}
