import { isDeepStrictEqual } from "node:util";
import type { PostgresApplicationStore } from "@ai-job-apply/applications-service";
import type {
  NativeResumeGenerationScope,
  NativeResumeReservation,
  PostgresNativeResumeGenerationStore,
} from "@ai-job-apply/documents-service/native-resume-generation-store";
import type { createNativeResumeTaskLaunch } from "@ai-job-apply/documents-service/native-resume-task-launch";

/** Private scalar preparation composition. The durable caller retains the returned original
 * scope. Completion only reads readiness and attaches its exact reference; it never launches,
 * loads candidate content, renders, renews or interprets a timeout as task death. */
export function createNativeResumePreparation(options: {
  generations: Pick<PostgresNativeResumeGenerationStore, "reserve" | "readLaunch">;
  launcher: Pick<ReturnType<typeof createNativeResumeTaskLaunch>, "launch" | "configurationSha256">;
  applications: Pick<PostgresApplicationStore, "attachNativeResume">;
  enabled?: () => boolean;
}) {
  const enabled = options.enabled ?? (() => false),
    generations = options.generations,
    launcher = options.launcher,
    applications = options.applications;
  const check = () => {
    if (!enabled()) throw Error("NativeResumePreparationUnavailable");
  };
  return Object.freeze({
    async start(input: NativeResumeReservation): Promise<NativeResumeGenerationScope> {
      check();
      const requested = structuredClone(input);
      const row = await generations.reserve(requested);
      check();
      if (!isDeepStrictEqual(row.reservation, requested))
        throw Error("NativeResumePreparationUnavailable");
      const scope = {
        ownerUserId: requested.identity.ownerUserId,
        applicationId: requested.identity.applicationId,
        generationId: requested.identity.generationId,
        allocationId: row.allocationId,
        epochId: row.epochId,
      };
      // An earlier durable claim is an observation-only path. Never resend after an unknown ACK.
      if (row.configurationSha256 === null) await launcher.launch(scope);
      else if (row.configurationSha256 !== launcher.configurationSha256)
        throw Error("NativeResumePreparationUnavailable");
      check();
      return Object.freeze(scope);
    },
    async complete(input: NativeResumeGenerationScope) {
      check();
      const scope = structuredClone(input);
      const row = await generations.readLaunch(scope, launcher.configurationSha256);
      check();
      if (!row.ready || !row.reference) return { kind: "in_progress" as const };
      const view = await applications.attachNativeResume(
        row.reservation.application,
        row.reference,
      );
      check();
      if (!view.currentPacket) throw Error("NativeResumePreparationUnavailable");
      return {
        kind: "ready" as const,
        packetId: view.currentPacket.id,
        revision: view.application.revision,
      };
    },
  });
}
