const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeOwnerMaterialCleanupUnavailable");

/** Private bounded worker step. The caller resolves the authenticated owner; never accept an
 * owner from public request data. Repeat the original request until its native tasks settle.
 * This does not certify provider retention, route removal or all-copy disposal. */
export function createNativeOwnerMaterialCleanup(options: {
  enabled?: () => boolean;
  withdrawals: {
    withdraw(
      owner: string,
      requestId: string,
    ): Promise<{ requestId: string; requestedAtMs: number; cutoffEpochMicros: string }>;
  };
  inventory: {
    pendingOwnerApplications(
      owner: string,
      throughMicros: string,
      limit: number,
      afterApplicationId?: string | null,
    ): Promise<string[]>;
  };
  disposal: {
    discardApplicationThrough(
      owner: string,
      application: string,
      throughMicros: string,
    ): Promise<"discarded">;
  };
}) {
  const check = () => {
    if (!options.enabled?.()) throw unavailable();
  };
  return Object.freeze({
    async step(owner: string, requestId: string, afterApplicationId: string | null = null) {
      check();
      if (
        !uuid.test(owner) ||
        !uuid.test(requestId) ||
        (afterApplicationId !== null && !uuid.test(afterApplicationId))
      )
        throw unavailable();
      try {
        const receipt = await options.withdrawals.withdraw(owner, requestId);
        check();
        if (
          receipt.requestId !== requestId ||
          !Number.isSafeInteger(receipt.requestedAtMs) ||
          receipt.requestedAtMs < 1
        )
          throw unavailable();
        if (!/^\d{16,17}$/u.test(receipt.cutoffEpochMicros)) throw unavailable();
        const cutoff = receipt.cutoffEpochMicros;
        const applications = await options.inventory.pendingOwnerApplications(
          owner,
          cutoff,
          5,
          afterApplicationId,
        );
        check();
        if (
          applications.length > 5 ||
          new Set(applications).size !== applications.length ||
          applications.some((id) => !uuid.test(id))
        )
          throw unavailable();
        for (const application of applications) {
          check();
          try {
            await options.disposal.discardApplicationThrough(owner, application, cutoff);
          } catch {
            // A claimed but unbound launch needs original recovery. Continue other applications;
            // the final inventory, not StopTask acknowledgement, decides whether work remains.
          }
          check();
        }
        const remaining = await options.inventory.pendingOwnerApplications(owner, cutoff, 1);
        check();
        if (remaining.length > 1 || remaining.some((id) => !uuid.test(id))) throw unavailable();
        return {
          requestId,
          requestedAtMs: receipt.requestedAtMs,
          nextApplicationId: applications.length === 5 ? (applications.at(-1) ?? null) : null,
          state: remaining.length ? ("pending" as const) : ("native_tasks_settled" as const),
        };
      } catch {
        throw unavailable();
      }
    },
  });
}
