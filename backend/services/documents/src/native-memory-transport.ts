import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import {
  createNativeMaterialTransportCore,
  type NativeMaterialTransportOptions,
} from "./native-material-transport-core.js";
import type { createNativeMemorySession } from "./native-memory-session.js";

export type { NativeMaterialReadAuthorization } from "./native-material-transport-core.js";
export interface NativeMemoryTransportOptions extends NativeMaterialTransportOptions {
  session: ReturnType<typeof createNativeMemorySession>;
}
const validPreview = compileComponentValidator("ApplicationCoverLetterPreview");
const validFile = compileComponentValidator("ApplicationCoverLetterFile");
/** Cover-letter adapter; shared HTTPS/OIDC/current-packet/lease behavior remains unchanged. */
export function createNativeMemoryTransport(options: NativeMemoryTransportOptions) {
  const session = options.session;
  const reference = { ...options.reference };
  return createNativeMaterialTransportCore({
    ...options,
    kind: "cover_letter",
    route: "cover-letter",
    read: (format, signal) =>
      format === "preview"
        ? session.reader.coverLetterPreview(
            reference.ownerUserId,
            reference.applicationId,
            reference,
            signal,
          )
        : session.reader.coverLetterFile(
            reference.ownerUserId,
            reference.applicationId,
            reference,
            format,
            signal,
          ),
    valid: (value, format, reference) => {
      if (
        !value ||
        typeof value !== "object" ||
        "temporaryMaterial" in value ||
        !("contentSha256" in value) ||
        value.contentSha256 !== reference.contentSha256
      )
        return false;
      if (format !== "preview")
        return validFile(value) && "format" in value && value.format === format;
      return (
        validPreview(value) &&
        "paragraphs" in value &&
        "documentId" in value &&
        value.documentId === reference.generationId &&
        "version" in value &&
        value.version === reference.version &&
        "matchesPacket" in value &&
        value.matchesPacket === true
      );
    },
  });
}
