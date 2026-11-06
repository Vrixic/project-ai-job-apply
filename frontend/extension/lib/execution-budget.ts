/**
 * How long one run on an employer page may last, from the moment it starts.
 *
 * A run that can submit keeps the short lease: it is the only run with a live effect that the
 * candidate has not reviewed. A fill-only run submits nothing (the candidate reviews the page and
 * submits it themselves) and is paced so they can watch it, and every freshness check in it reads
 * the platform several times, so it needs room on a slow connection. Both stay bounded by the
 * approval and the material leases.
 */
export const RUN_BUDGET_MS = 60_000;
export const FILL_ONLY_BUDGET_MS = 5 * 60_000;
/** One short budget of its own to report that a dispatched attempt did not finish. */
export const RECOVERY_BUDGET_MS = 15_000;

export const runBudgetMs = (fillOnly: boolean | undefined) =>
  fillOnly === true ? FILL_ONLY_BUDGET_MS : RUN_BUDGET_MS;
