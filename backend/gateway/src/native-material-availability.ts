import { AsyncLocalStorage } from "node:async_hooks";
import { request } from "node:https";
import type { ApplicationTemporaryMaterials } from "@ai-job-apply/applications-service";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/domain/temporary-material";

const credentials = new AsyncLocalStorage<{
  ownerUserId: string;
  applicationId: string;
  token: string | undefined;
}>();

/** Called only after Gateway identity resolution. No process-global token or credential cache. */
export async function withNativeMaterialCredential<T>(
  ownerUserId: string,
  applicationId: string,
  token: string,
  work: () => Promise<T>,
): Promise<T> {
  const scope = { ownerUserId, applicationId, token: token as string | undefined };
  try {
    return await credentials.run(scope, work);
  } finally {
    scope.token = undefined;
  }
}

type Location = {
  baseHost: string;
  resolve(reference: TemporaryMaterialReference, signal: AbortSignal): Promise<string | null>;
};

export type NativeMaterialAvailabilityFailure = Readonly<{
  stage: "admission" | "location" | "address" | "head" | "metadata" | "freshness";
  status?: number;
  transport?: "dns" | "tls" | "connection" | "aborted" | "other";
}>;

type ReportFailure = (failure: NativeMaterialAvailabilityFailure) => void;

/** Metadata-only, point-in-time memory availability. Never downloads a generated body. */
export function createNativeMaterialAvailability(options: {
  coverLetter?: Location;
  resume?: Location;
  enabled: () => boolean;
  reportFailure?: ReportFailure;
}): Pick<ApplicationTemporaryMaterials, "current"> {
  const locations = {
    cover_letter: options.coverLetter ? { ...options.coverLetter } : undefined,
    tailored_resume: options.resume ? { ...options.resume } : undefined,
  };
  return {
    async current(ownerUserId, applicationId, reference) {
      const report = (failure: NativeMaterialAvailabilityFailure) => {
        try {
          options.reportFailure?.(Object.freeze({ ...failure }));
        } catch {
          // Diagnostics cannot change availability or expose the original failure.
        }
      };
      const credential = credentials.getStore();
      if (
        !options.enabled() ||
        !credential?.token ||
        credential.ownerUserId !== ownerUserId ||
        credential.applicationId !== applicationId ||
        !validateTemporaryMaterialReference(reference) ||
        reference.ownerUserId !== ownerUserId ||
        reference.applicationId !== applicationId
      ) {
        report({ stage: "admission" });
        throw Error("NativeMaterialAvailabilityUnavailable");
      }
      const fixed = Object.freeze({ ...reference });
      const location = locations[fixed.kind];
      if (
        !location ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(location.baseHost)
      ) {
        report({ stage: "location" });
        throw Error("NativeMaterialAvailabilityUnavailable");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      timer.unref();
      const live = () =>
        options.enabled() &&
        !!credential.token &&
        !controller.signal.aborted &&
        Date.now() < fixed.expiresAtMs;
      let stage: NativeMaterialAvailabilityFailure["stage"] = "location";
      let status: number | undefined;
      let transport: NativeMaterialAvailabilityFailure["transport"];
      try {
        if (!live()) return null;
        const address = await Promise.race([
          location.resolve(fixed, controller.signal),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(Error("NativeMaterialAvailabilityUnavailable")),
              { once: true },
            );
          }),
        ]);
        if (!live()) throw Error();
        if (!address) return null;
        stage = "address";
        const target = new URL(address);
        const allocation = target.hostname.slice(0, -(location.baseHost.length + 1));
        if (
          target.protocol !== "https:" ||
          target.port !== "8443" ||
          target.username ||
          target.password ||
          target.search ||
          target.hash ||
          target.pathname !== "/" ||
          target.hostname !== `${allocation}.${location.baseHost}` ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(allocation)
        )
          throw Error();
        target.pathname = `/v1/applications/${applicationId}/${fixed.kind === "cover_letter" ? "cover-letter" : "resume"}`;
        stage = "head";
        const current = await new Promise<TemporaryMaterialReference>((resolve, reject) => {
          const req = request(
            target,
            {
              method: "HEAD",
              agent: false,
              minVersion: "TLSv1.3",
              maxHeaderSize: 4096,
              signal: controller.signal,
              headers: { authorization: `Bearer ${credential.token}`, connection: "close" },
            },
            (response) => {
              try {
                status = response.statusCode;
                if (status === 204) stage = "metadata";
                const encoded = response.headers["x-native-material-reference"];
                if (
                  response.statusCode !== 204 ||
                  typeof encoded !== "string" ||
                  encoded.length > 2048 ||
                  !/^[a-zA-Z0-9_-]+$/u.test(encoded) ||
                  response.headers["transfer-encoding"] !== undefined ||
                  (response.headers["content-length"] !== undefined &&
                    response.headers["content-length"] !== "0")
                )
                  throw Error();
                const value: unknown = JSON.parse(
                  Buffer.from(encoded, "base64url").toString("utf8"),
                );
                if (
                  !validateTemporaryMaterialReference(value) ||
                  !sameTemporaryMaterialReference(fixed, value)
                )
                  throw Error();
                resolve({ ...value });
              } catch {
                reject(Error("NativeMaterialAvailabilityUnavailable"));
              } finally {
                response.destroy();
              }
            },
          );
          req.once("error", (failure: NodeJS.ErrnoException) => {
            const code = failure.code ?? "";
            transport =
              code === "ENOTFOUND" || code === "EAI_AGAIN"
                ? "dns"
                : code === "ABORT_ERR"
                  ? "aborted"
                  : code.startsWith("ERR_TLS_") ||
                      code.startsWith("CERT_") ||
                      [
                        "DEPTH_ZERO_SELF_SIGNED_CERT",
                        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
                        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
                      ].includes(code)
                    ? "tls"
                    : [
                          "ECONNREFUSED",
                          "ECONNRESET",
                          "ENETUNREACH",
                          "EHOSTUNREACH",
                          "ETIMEDOUT",
                        ].includes(code)
                      ? "connection"
                      : "other";
            reject(Error("NativeMaterialAvailabilityUnavailable"));
          });
          req.end();
        });
        stage = "freshness";
        if (!live()) throw Error();
        return current;
      } catch {
        report({
          stage,
          ...(status === undefined ? {} : { status }),
          ...(transport ? { transport } : {}),
        });
        throw Error("NativeMaterialAvailabilityUnavailable");
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}

export function nativeMaterialAvailabilityFromEnvironment(
  environment: NodeJS.ProcessEnv,
  protectionEnabled: () => boolean,
  coverLetter: Omit<Location, "baseHost"> | undefined,
  resume: Omit<Location, "baseHost"> | undefined,
  reportFailure?: ReportFailure,
): ApplicationTemporaryMaterials {
  const letterHost = environment.NATIVE_MATERIAL_BASE_HOST ?? "";
  const resumeHost = environment.NATIVE_RESUME_BASE_HOST ?? "";
  return createNativeMaterialAvailability({
    ...(reportFailure ? { reportFailure } : {}),
    ...(coverLetter
      ? { coverLetter: { baseHost: letterHost, resolve: coverLetter.resolve.bind(coverLetter) } }
      : {}),
    ...(resume ? { resume: { baseHost: resumeHost, resolve: resume.resolve.bind(resume) } } : {}),
    enabled: () =>
      environment.NATIVE_MATERIAL_AVAILABILITY_ENABLED === "true" &&
      environment.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED === "true" &&
      protectionEnabled() &&
      (!coverLetter || environment.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED === "true") &&
      (!resume || environment.NATIVE_RESUME_READ_LOCATIONS_ENABLED === "true") &&
      environment.NATIVE_MATERIAL_BASE_HOST === (letterHost || undefined) &&
      environment.NATIVE_RESUME_BASE_HOST === (resumeHost || undefined),
  });
}
