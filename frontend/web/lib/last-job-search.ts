import type { CanonicalJobSummary } from "@ai-job-apply/api-contracts";
import type { JobSearchFields } from "../app/job-search-state";

/**
 * The candidate's last job search, held in this page's memory only (never in browser storage), so that
 * opening a job's own page and coming back does not lose the results. It lives as long as the app does
 * in the tab: client-side navigation and the browser's Back keep it, a reload, leaving the site and
 * signing out (a full navigation) drop it, and the form drops it itself on session end and when a new
 * search finds nothing.
 */
export interface LastJobSearch {
  /** The filters that produced `items`. */
  fields: JobSearchFields;
  items: CanonicalJobSummary[];
  cursor?: string;
}

let held: LastJobSearch | undefined;

export function saveLastJobSearch(search: LastJobSearch): void {
  held = {
    fields: { ...search.fields },
    items: [...search.items],
    ...(search.cursor ? { cursor: search.cursor } : {}),
  };
}

export function readLastJobSearch(): LastJobSearch | undefined {
  return held
    ? {
        fields: { ...held.fields },
        items: [...held.items],
        ...(held.cursor ? { cursor: held.cursor } : {}),
      }
    : undefined;
}

export function clearLastJobSearch(): void {
  held = undefined;
}
