import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SavedJobCursorKeySet {
  primary: Buffer;
  fallbacks?: readonly Buffer[];
}

interface SavedJobCursorPayload {
  v: 1;
  owner: string;
  revision: string;
  catalogRevision: string;
  savedAt: string;
  id: string;
}

export class InvalidSavedJobCursorError extends Error {
  constructor(message = "Saved-job cursor is invalid") {
    super(message);
    this.name = "InvalidSavedJobCursorError";
  }
}

export class SavedJobCollectionChangedError extends Error {
  constructor() {
    super("Saved jobs changed; restart the list from the first page");
    this.name = "SavedJobCollectionChangedError";
  }
}

function ownerBinding(ownerUserId: string, key: Buffer): string {
  return createHmac("sha256", key).update(`owner:${ownerUserId}`).digest("base64url");
}

function signature(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(encodedPayload).digest();
}

export function deriveSavedJobCursorKeys(databaseUrl: string): SavedJobCursorKeySet {
  return {
    primary: createHash("sha256")
      .update(`ai-job-apply:saved-job-cursor:v1:${databaseUrl}`)
      .digest(),
  };
}

export function encodeSavedJobCursor(
  ownerUserId: string,
  revision: string,
  catalogRevision: string,
  savedAt: Date,
  id: string,
  keys: SavedJobCursorKeySet,
): string {
  const payload: SavedJobCursorPayload = {
    v: 1,
    owner: ownerBinding(ownerUserId, keys.primary),
    revision,
    catalogRevision,
    savedAt: savedAt.toISOString(),
    id,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, keys.primary).toString("base64url")}`;
}

export function decodeSavedJobCursor(
  cursor: string | undefined,
  ownerUserId: string,
  currentRevision: string,
  currentCatalogRevision: string,
  keys: SavedJobCursorKeySet,
): { savedAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidSavedJobCursorError();
  }
  const [encoded, encodedSignature] = cursor.split(".");
  if (!encoded || !encodedSignature) throw new InvalidSavedJobCursorError();
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new InvalidSavedJobCursorError();
  }
  const key = [keys.primary, ...(keys.fallbacks ?? [])].find((candidate) => {
    const expected = signature(encoded, candidate);
    return (
      expected.length === providedSignature.length && timingSafeEqual(expected, providedSignature)
    );
  });
  if (!key) throw new InvalidSavedJobCursorError();

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidSavedJobCursorError();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidSavedJobCursorError();
  }
  const candidate = payload as Partial<SavedJobCursorPayload> & Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "catalogRevision,id,owner,revision,savedAt,v" ||
    candidate.v !== 1 ||
    candidate.owner !== ownerBinding(ownerUserId, key) ||
    typeof candidate.revision !== "string" ||
    typeof candidate.catalogRevision !== "string" ||
    typeof candidate.savedAt !== "string" ||
    typeof candidate.id !== "string"
  ) {
    throw new InvalidSavedJobCursorError();
  }
  if (candidate.revision !== currentRevision) throw new SavedJobCollectionChangedError();
  if (candidate.catalogRevision !== currentCatalogRevision) {
    throw new SavedJobCollectionChangedError();
  }
  const savedAt = new Date(candidate.savedAt);
  if (!Number.isFinite(savedAt.getTime())) throw new InvalidSavedJobCursorError();
  return { savedAt, id: candidate.id };
}
