import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import type { NativeMemoryTransportOptions } from "./native-memory-transport.js";
import { validateTemporaryMaterialReference } from "./temporary-material-reference.js";

/** Owning admission surrounds each packet proof; no SQL lock spans remote authorization.
 * A proof grants no renewal, task liveness or disposal acknowledgement. */
export function createAdmittedNativeReadAuthorization(options: {
  binding: NativeEvidenceBinding;
  checkAdmission(binding: Readonly<NativeEvidenceBinding>): Promise<void>;
  authorize: NativeMemoryTransportOptions["authorize"];
  enabled?: () => boolean;
}): NativeMemoryTransportOptions["authorize"] {
  const binding = nativeEvidenceBinding(options.binding);
  const enabled = options.enabled ?? (() => false);
  const admit = options.checkAdmission,
    authorize = options.authorize;
  return async (owner, application, reference, signal, token) => {
    try {
      if (
        !enabled() ||
        signal.aborted ||
        !validateTemporaryMaterialReference(reference) ||
        reference.kind !== "cover_letter" ||
        owner !== binding.scope.ownerUserId ||
        application !== binding.scope.applicationId ||
        reference.ownerUserId !== owner ||
        reference.applicationId !== application ||
        reference.generationId !== binding.scope.generationId
      )
        throw Error();
      const fixed = Object.freeze({ ...reference });
      const permitted = () => enabled() && !signal.aborted && Date.now() < fixed.expiresAtMs;
      if (!permitted()) throw Error();
      await admit(binding);
      if (!permitted()) throw Error();
      const proof = await authorize(owner, application, fixed, signal, token);
      if (!permitted()) throw Error();
      await admit(binding);
      if (!permitted()) throw Error();
      return proof;
    } catch {
      throw Error("NativeReadAuthorizationUnavailable");
    }
  };
}
