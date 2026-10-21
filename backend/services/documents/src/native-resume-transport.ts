import {
  type ApplicationResumeFile,
  type ApplicationResumePreview,
  compileComponentValidator,
} from "@ai-job-apply/api-contracts";
import {
  createNativeMaterialTransportCore,
  type NativeMaterialTransportOptions,
} from "./native-material-transport-core.js";
import type { createNativeResumeSession } from "./native-resume-session.js";

type Session = ReturnType<typeof createNativeResumeSession>;
export interface NativeResumeTransportOptions extends NativeMaterialTransportOptions {
  session: Pick<Session, "read">;
  tailoringVersion: string;
}
const validPreview = compileComponentValidator("ApplicationResumePreview");
const validFile = compileComponentValidator("ApplicationResumeFile");

/** Direct native-process resume reads. The shared transport proves current packet and OIDC
 * identity before and after the held read; neither preview nor files renew original expiry. */
export function createNativeResumeTransport(options: NativeResumeTransportOptions) {
  const reference = { ...options.reference },
    version = options.tailoringVersion;
  const read = options.session?.read.bind(options.session);
  return createNativeMaterialTransportCore({
    ...options,
    kind: "tailored_resume",
    route: "resume",
    async read(format, signal) {
      if (!read || typeof version !== "string" || version.length < 1 || version.length > 32)
        throw Error("NativeMemoryTransportUnavailable");
      // Generated resumes are delivered only as PDF.
      if (format !== "preview" && format !== "pdf") throw Error("NativeMemoryTransportUnavailable");
      const held = await read(reference, format, signal);
      let value: ApplicationResumePreview | ApplicationResumeFile | undefined;
      const release = () => {
        if (value && "contentBase64" in value) value.contentBase64 = "";
        held.release();
      };
      try {
        if (format === "preview") {
          if (!("sections" in held.value)) throw Error("NativeMemoryTransportUnavailable");
          value = {
            status: "ready",
            matchesPacket: true,
            tailoringVersion: version,
            contentSha256: reference.contentSha256,
            sections: held.value.sections,
            matchedTerms: held.value.matchedTerms,
          };
        } else {
          if (!("bytes" in held.value)) throw Error("NativeMemoryTransportUnavailable");
          value = {
            format,
            mediaType: held.value.mediaType,
            fileName: `tailored-resume.${format}`,
            sha256: held.value.sha256,
            sizeBytes: held.value.bytes.byteLength,
            contentSha256: reference.contentSha256,
            contentBase64: Buffer.from(
              held.value.bytes.buffer,
              held.value.bytes.byteOffset,
              held.value.bytes.byteLength,
            ).toString("base64"),
          };
        }
        return {
          reference: held.reference,
          signal: held.signal,
          isCurrent: held.isCurrent,
          revalidate: held.revalidate,
          value,
          release,
        };
      } catch {
        release();
        throw Error("NativeMemoryTransportUnavailable");
      }
    },
    valid(value, format, original) {
      if (
        !value ||
        typeof value !== "object" ||
        "temporaryMaterial" in value ||
        !("contentSha256" in value) ||
        value.contentSha256 !== original.contentSha256
      )
        return false;
      if (format !== "preview")
        return validFile(value) && "format" in value && value.format === format;
      return (
        validPreview(value) &&
        "status" in value &&
        value.status === "ready" &&
        "matchesPacket" in value &&
        value.matchesPacket === true &&
        "tailoringVersion" in value &&
        value.tailoringVersion === version &&
        "sections" in value &&
        "matchedTerms" in value
      );
    },
  });
}
