/**
 * Keeps the candidate's own uploaded resume in this page's memory once it has been fetched, so the
 * comparison view reads it from the server once per browser session instead of every time it is opened.
 * Memory only: nothing is written to storage and the server's `no-store` response is unchanged.
 *
 * The file is held under the application and the packet it was read for. The server only hands it over
 * while that packet is current, and a new packet (a regenerated or replaced resume) has a new hash, so
 * a stale file can never be served from here. Only the newest file is held; its bytes are zeroed when
 * it is replaced and when the page is left or the candidate signs out.
 */

let held: { key: string; bytes: Uint8Array } | undefined;

/** What identifies one read of the original: the application and its current packet. */
export const uploadedResumeKey = (applicationId: string, packetHash: string): string =>
  `${applicationId}:${packetHash}`;

/** The held file for this key, if it is the one held. */
export function cachedUploadedResume(key: string): Uint8Array | undefined {
  return held && held.key === key ? held.bytes : undefined;
}

/** Holds a verified file (its digest already checked) and zeroes whatever it replaces. */
export function holdUploadedResume(key: string, bytes: Uint8Array): void {
  if (held && held.bytes !== bytes) held.bytes.fill(0);
  held = { key, bytes };
}

/** Zeroes and forgets the held file. */
export function dropUploadedResume(): void {
  held?.bytes.fill(0);
  held = undefined;
}
