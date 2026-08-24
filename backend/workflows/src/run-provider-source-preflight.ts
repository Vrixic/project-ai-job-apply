import { preflightProviderSourceConfigurations } from "./ingestion-lambda.js";

const confirmation = process.env.D1_PROVIDER_SOURCE_PREFLIGHT_CONFIRMATION;
const configuration = process.env.D1_PROVIDER_SOURCE_CONFIGURATION;

if (confirmation !== "validate-default-off-provider-source" || typeof configuration !== "string") {
  process.stderr.write("Provider source preflight requires the exact confirmation and input.\n");
  process.exitCode = 2;
} else {
  try {
    const sources = preflightProviderSourceConfigurations(configuration);
    process.stdout.write(
      `${JSON.stringify({
        outcome: "validated-default-off-provider-sources",
        sourceCount: sources.length,
        sources,
      })}\n`,
    );
  } catch {
    process.stderr.write("Provider source preflight rejected the configuration.\n");
    process.exitCode = 1;
  }
}
