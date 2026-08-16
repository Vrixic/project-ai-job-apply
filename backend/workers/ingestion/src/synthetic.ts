import type { IngestionSourceAdapter, SourceJobObservation, SourcePollResult } from "./contract.js";

export const generatedSyntheticSourceId = "synthetic-foundation-v1";
export const generatedSyntheticAdapterVersion = "synthetic-ingestion-v1";
const syntheticSeedPattern = /^[a-z0-9]{8,64}$/;

export function buildGeneratedSyntheticObservations(
  seed: string,
  observedAt: Date,
): readonly SourceJobObservation[] {
  if (!syntheticSeedPattern.test(seed) || !Number.isFinite(observedAt.getTime())) {
    throw new Error("A canonical synthetic seed and timestamp are required");
  }
  const validThrough = new Date(observedAt.getTime() + 45 * 24 * 60 * 60 * 1_000);
  const companyName = `Generated Synthetic Company ${seed}`;
  const verifiedCompanyDomain = `${seed}.example.test`;
  return [
    {
      companyName,
      title: "Generated Systems Engineer",
      locations: ["Remote - US"],
      description:
        "Generated synthetic job content for deterministic source-neutral ingestion verification.",
      sourceUrl: `https://jobs.example.test/source-neutral/${seed}/systems-engineer`,
      atsTenant: `synthetic-${seed}`,
      externalJobId: "generated-job-1",
      employerRequisitionId: `generated-${seed}-1`,
      verifiedCompanyDomain,
      department: "Synthetic Engineering",
      workMode: "remote",
      employmentType: "full_time",
      validThrough: new Date(validThrough),
    },
    {
      companyName,
      title: "Generated Reliability Engineer",
      locations: ["Synthetic City, NY"],
      description:
        "Generated synthetic reliability content with no provider, employer, or candidate data.",
      sourceUrl: `https://jobs.example.test/source-neutral/${seed}/reliability-engineer`,
      atsTenant: `synthetic-${seed}`,
      externalJobId: "generated-job-2",
      employerRequisitionId: `generated-${seed}-2`,
      verifiedCompanyDomain,
      department: "Synthetic Reliability",
      workMode: "hybrid",
      employmentType: "full_time",
      validThrough: new Date(validThrough),
    },
  ];
}

export class GeneratedSyntheticIngestionAdapter implements IngestionSourceAdapter {
  readonly sourceId = generatedSyntheticSourceId;
  readonly adapterVersion = generatedSyntheticAdapterVersion;

  constructor(private readonly seed: string) {}

  async poll({ observedAt }: { observedAt: Date; signal: AbortSignal }): Promise<SourcePollResult> {
    return {
      kind: "success",
      observations: buildGeneratedSyntheticObservations(this.seed, observedAt),
    };
  }
}
