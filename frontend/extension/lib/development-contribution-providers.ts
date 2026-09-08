import type { AtsProvider, JobPageVariant } from "./job-capture";

interface DevelopmentContributionProvider {
  readonly variant: JobPageVariant;
  readonly domains: readonly string[];
  readonly revision: string;
}

/** Fixed source descriptors, not activation flags or permission grants. */
export const DEVELOPMENT_CONTRIBUTION_PROVIDERS: Readonly<
  Record<AtsProvider, DevelopmentContributionProvider>
> = Object.freeze({
  greenhouse: Object.freeze({
    variant: "greenhouse-board-v1",
    domains: Object.freeze(["boards.greenhouse.io", "job-boards.greenhouse.io"]),
    revision: "d2-development-greenhouse-persistent-v1",
  }),
  lever: Object.freeze({
    variant: "lever-posting-v1",
    domains: Object.freeze(["jobs.lever.co", "jobs.eu.lever.co"]),
    revision: "d2-development-lever-persistent-v1",
  }),
  ashby: Object.freeze({
    variant: "ashby-job-board-v1",
    domains: Object.freeze(["jobs.ashbyhq.com"]),
    revision: "d2-development-ashby-persistent-v1",
  }),
});

/** Invalid injected configuration denies every provider; it never falls back to Greenhouse. */
export function parseDevelopmentContributionProviders(value: unknown): readonly AtsProvider[] {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    new Set(value).size !== value.length ||
    [...value].some(
      (provider) =>
        typeof provider !== "string" ||
        !Object.hasOwn(DEVELOPMENT_CONTRIBUTION_PROVIDERS, provider),
    )
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([...value].sort() as AtsProvider[]);
}
