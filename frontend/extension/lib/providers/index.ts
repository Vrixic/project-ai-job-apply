import { ADAPTER_DECLARATIONS, AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { ashbyProvider } from "../ashby/provider";
import { greenhouseProvider } from "../greenhouse/provider";
import { buildExecutionControls } from "./controls";
import { applicationImplementationSha256 } from "./implementation";
import type { ApplicationProvider } from "./types";

/** Reviewed providers only. A page is supported when exactly one provider recognizes its URL. */
export const applicationProviders: readonly ApplicationProvider[] = [
  greenhouseProvider,
  ashbyProvider,
];

export function providerForUrl(url: string): ApplicationProvider | undefined {
  const matches = applicationProviders.filter((provider) => provider.identity(url) !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

/** The one execution gate for every provider: kill switches, live-effect approval and evidence. */
export const applicationExecutionRegistry = new AdapterRegistry(
  ADAPTER_DECLARATIONS,
  buildExecutionControls(applicationImplementationSha256),
);
