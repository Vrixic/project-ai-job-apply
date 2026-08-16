import {
  assessMatch,
  type MatchAssessmentInput,
  MatchAssessmentUnavailableError,
} from "./match-assessment.js";

const ROLE_FAMILIES = ["software", "data", "product"] as const;
const CAREER_STAGES = ["early", "mid"] as const;
const CORE_SCENARIOS = [
  "aligned",
  "work_conflict",
  "employment_conflict",
  "sparse_semantic_near",
] as const;
const GUARDRAIL_SCENARIOS = [
  "work_mode_unknown",
  "work_mode_absent",
  "employment_type_unknown",
  "employment_type_absent",
  "title_nfkc_case_space",
  "location_nfkc_case_space",
  "title_semantic_near",
  "location_semantic_near",
  "compensation_pair_unavailable",
  "dual_exact_conflict",
  "legacy_sponsorship_true",
  "legacy_sponsorship_false",
] as const;
const EXPECTED_REASON_CODES = new Set([
  "work_mode_selected",
  "work_mode_conflict",
  "work_mode_unavailable",
  "employment_type_selected",
  "employment_type_conflict",
  "employment_type_unavailable",
  "target_role_exact_overlap",
  "target_role_not_established",
  "location_exact_overlap",
  "location_not_established",
  "compensation_semantics_unavailable",
  "authorization_sponsorship_unavailable",
  "seniority_semantics_unavailable",
  "blocked_company_preferences_unavailable",
  "qualification_evidence_unavailable",
]);

type RoleFamily = (typeof ROLE_FAMILIES)[number];
type CareerStage = (typeof CAREER_STAGES)[number];

interface EvaluationFixture {
  readonly id: string;
  readonly roleFamily: RoleFamily;
  readonly careerStage: CareerStage;
  readonly preferences: MatchAssessmentInput["preferences"];
  readonly job: MatchAssessmentInput["job"];
}

interface AssessmentExpectation {
  readonly id: string;
  readonly outcome: "assessment";
  readonly gate: "excluded" | "review_required";
  readonly evidence: readonly (readonly [string, string, string])[];
}

interface UnavailableExpectation {
  readonly id: string;
  readonly outcome: "restricted_preference_requires_review";
}

type EvaluationExpectation = AssessmentExpectation | UnavailableExpectation;

interface EvaluationCase {
  readonly id: string;
  readonly kind: "core" | "guardrail";
  readonly fixtureId: string;
  readonly scenario: string;
  readonly preferencePatch?: Readonly<Record<string, unknown>>;
  readonly jobPatch?: Readonly<Record<string, unknown>>;
  readonly unsetJobFields?: readonly ("workMode" | "employmentType")[];
  readonly expectationId: string;
}

interface EvaluationDocument {
  readonly fixtures: readonly EvaluationFixture[];
  readonly expectations: readonly EvaluationExpectation[];
  readonly cases: readonly EvaluationCase[];
}

export interface D1MatchEvaluationReport {
  readonly caseCount: 36;
  readonly assessmentCount: 34;
  readonly unavailableCount: 2;
  readonly evidenceTupleCount: 306;
  readonly knownConflictCount: 13;
  readonly nonConflictCount: 21;
  readonly falseExclusionCount: 0;
  readonly coveredReasonCodeCount: 15;
  readonly deterministicReplayCount: 36;
  readonly segmentCellCount: 6;
}

export class D1MatchEvaluationRejectedError extends Error {
  constructor() {
    super("The D1 match-assessment evaluation document was rejected");
    this.name = "D1MatchEvaluationRejectedError";
  }
}

function reject(): never {
  throw new D1MatchEvaluationRejectedError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function stringChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function parseFixture(value: unknown): EvaluationFixture {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "roleFamily", "careerStage", "preferences", "job"]) ||
    typeof value.id !== "string" ||
    !stringChoice(value.roleFamily, ROLE_FAMILIES) ||
    !stringChoice(value.careerStage, CAREER_STAGES) ||
    !isRecord(value.preferences) ||
    !isRecord(value.job)
  ) {
    return reject();
  }

  const fixture = {
    id: value.id,
    roleFamily: value.roleFamily,
    careerStage: value.careerStage,
    preferences: value.preferences,
    job: value.job,
  } as unknown as EvaluationFixture;
  try {
    assessMatch({ preferences: fixture.preferences, job: fixture.job });
  } catch {
    return reject();
  }
  return fixture;
}

function parseExpectation(value: unknown): EvaluationExpectation {
  if (!isRecord(value) || typeof value.id !== "string") return reject();
  if (value.outcome === "restricted_preference_requires_review") {
    if (!exactKeys(value, ["id", "outcome"])) return reject();
    return value as unknown as UnavailableExpectation;
  }
  if (
    value.outcome !== "assessment" ||
    !exactKeys(value, ["id", "outcome", "gate", "evidence"]) ||
    !stringChoice(value.gate, ["excluded", "review_required"] as const) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length !== 9 ||
    !value.evidence.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 3 &&
        entry.every((part) => typeof part === "string") &&
        EXPECTED_REASON_CODES.has(entry[2] as string),
    )
  ) {
    return reject();
  }
  return value as unknown as AssessmentExpectation;
}

function parsePatch(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return reject();
  return value;
}

function parseCase(value: unknown): EvaluationCase {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      ["id", "kind", "fixtureId", "scenario", "expectationId"],
      ["preferencePatch", "jobPatch", "unsetJobFields"],
    ) ||
    typeof value.id !== "string" ||
    !stringChoice(value.kind, ["core", "guardrail"] as const) ||
    typeof value.fixtureId !== "string" ||
    typeof value.scenario !== "string" ||
    typeof value.expectationId !== "string"
  ) {
    return reject();
  }
  const unsetJobFields = value.unsetJobFields;
  if (
    unsetJobFields !== undefined &&
    (!Array.isArray(unsetJobFields) ||
      unsetJobFields.length !== 1 ||
      !stringChoice(unsetJobFields[0], ["workMode", "employmentType"] as const))
  ) {
    return reject();
  }
  return {
    id: value.id,
    kind: value.kind,
    fixtureId: value.fixtureId,
    scenario: value.scenario,
    expectationId: value.expectationId,
    ...(value.preferencePatch === undefined
      ? {}
      : { preferencePatch: parsePatch(value.preferencePatch) }),
    ...(value.jobPatch === undefined ? {} : { jobPatch: parsePatch(value.jobPatch) }),
    ...(unsetJobFields === undefined
      ? {}
      : { unsetJobFields: unsetJobFields as ("workMode" | "employmentType")[] }),
  };
}

function parseDocument(value: unknown): EvaluationDocument {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "evaluationSetId",
      "classification",
      "approvalState",
      "representation",
      "fixtures",
      "expectations",
      "cases",
    ]) ||
    value.schemaVersion !== 1 ||
    value.evaluationSetId !== "d1-match-assessment-synthetic-v1" ||
    value.classification !== "generated_synthetic" ||
    value.approvalState !== "pending_product_and_qa_review" ||
    !isRecord(value.representation) ||
    !exactKeys(value.representation, [
      "geography",
      "language",
      "roleFamilies",
      "careerStages",
      "claim",
    ]) ||
    value.representation.geography !== "US" ||
    value.representation.language !== "en-US" ||
    JSON.stringify(value.representation.roleFamilies) !== JSON.stringify(ROLE_FAMILIES) ||
    JSON.stringify(value.representation.careerStages) !== JSON.stringify(CAREER_STAGES) ||
    value.representation.claim !== "launch_segment_scenario_coverage_only" ||
    !Array.isArray(value.fixtures) ||
    !Array.isArray(value.expectations) ||
    !Array.isArray(value.cases)
  ) {
    return reject();
  }

  return {
    fixtures: value.fixtures.map(parseFixture),
    expectations: value.expectations.map(parseExpectation),
    cases: value.cases.map(parseCase),
  };
}

function materialize(fixture: EvaluationFixture, evaluationCase: EvaluationCase) {
  const preferences = {
    ...structuredClone(fixture.preferences),
    ...structuredClone(evaluationCase.preferencePatch ?? {}),
  } as MatchAssessmentInput["preferences"];
  const job = {
    ...structuredClone(fixture.job),
    ...structuredClone(evaluationCase.jobPatch ?? {}),
  } as MatchAssessmentInput["job"];
  const mutableJob = job as unknown as Record<string, unknown>;
  for (const field of evaluationCase.unsetJobFields ?? []) delete mutableJob[field];
  return { preferences, job };
}

function evidenceTuples(result: ReturnType<typeof assessMatch>) {
  return result.evidence.map((entry) => [entry.constraint, entry.state, entry.reasonCode]);
}

export function evaluateD1MatchAssessment(value: unknown): D1MatchEvaluationReport {
  const document = parseDocument(value);
  if (
    document.fixtures.length !== 6 ||
    document.expectations.length !== 10 ||
    document.cases.length !== 36 ||
    !uniqueStrings(document.fixtures.map(({ id }) => id)) ||
    !uniqueStrings(document.expectations.map(({ id }) => id)) ||
    !uniqueStrings(document.cases.map(({ id }) => id))
  ) {
    return reject();
  }

  const fixtures = new Map(document.fixtures.map((fixture) => [fixture.id, fixture]));
  const expectations = new Map(
    document.expectations.map((expectation) => [expectation.id, expectation]),
  );
  const cells = new Map<string, string[]>();
  for (const fixture of document.fixtures) {
    const cell = `${fixture.roleFamily}:${fixture.careerStage}`;
    if (cells.has(cell)) return reject();
    cells.set(cell, []);
  }

  let assessmentCount = 0;
  let unavailableCount = 0;
  let evidenceTupleCount = 0;
  let knownConflictCount = 0;
  let nonConflictCount = 0;
  let falseExclusionCount = 0;
  let deterministicReplayCount = 0;
  const coveredReasonCodes = new Set<string>();
  const guardrailScenarios: string[] = [];

  for (const evaluationCase of document.cases) {
    const fixture = fixtures.get(evaluationCase.fixtureId);
    const expectation = expectations.get(evaluationCase.expectationId);
    if (!fixture || !expectation) return reject();
    if (evaluationCase.kind === "core") {
      if (!stringChoice(evaluationCase.scenario, CORE_SCENARIOS)) return reject();
      cells.get(`${fixture.roleFamily}:${fixture.careerStage}`)?.push(evaluationCase.scenario);
    } else {
      if (!stringChoice(evaluationCase.scenario, GUARDRAIL_SCENARIOS)) return reject();
      guardrailScenarios.push(evaluationCase.scenario);
    }

    const input = materialize(fixture, evaluationCase);
    try {
      const first = assessMatch(input);
      const second = assessMatch(materialize(fixture, evaluationCase));
      if (expectation.outcome !== "assessment") return reject();
      const actualEvidence = evidenceTuples(first);
      if (
        first.gate !== expectation.gate ||
        JSON.stringify(actualEvidence) !== JSON.stringify(expectation.evidence) ||
        JSON.stringify(first) !== JSON.stringify(second)
      ) {
        return reject();
      }
      assessmentCount += 1;
      evidenceTupleCount += actualEvidence.length;
      deterministicReplayCount += 1;
      for (const entry of first.evidence) coveredReasonCodes.add(entry.reasonCode);
      const hasKnownConflict = expectation.evidence.some((entry) => entry[1] === "conflict");
      if (hasKnownConflict) {
        knownConflictCount += 1;
        if (first.gate !== "excluded") return reject();
      } else {
        nonConflictCount += 1;
        if (first.gate === "excluded") falseExclusionCount += 1;
      }
    } catch (error) {
      if (
        !(error instanceof MatchAssessmentUnavailableError) ||
        expectation.outcome !== "restricted_preference_requires_review"
      ) {
        return reject();
      }
      try {
        assessMatch(materialize(fixture, evaluationCase));
        return reject();
      } catch (replayError) {
        if (!(replayError instanceof MatchAssessmentUnavailableError)) return reject();
      }
      unavailableCount += 1;
      deterministicReplayCount += 1;
    }
  }

  for (const scenarios of cells.values()) {
    if (
      scenarios.length !== 4 ||
      !CORE_SCENARIOS.every((scenario) => scenarios.includes(scenario))
    ) {
      return reject();
    }
  }
  if (
    guardrailScenarios.length !== GUARDRAIL_SCENARIOS.length ||
    !GUARDRAIL_SCENARIOS.every(
      (scenario) => guardrailScenarios.filter((candidate) => candidate === scenario).length === 1,
    )
  ) {
    return reject();
  }

  if (
    cells.size !== 6 ||
    assessmentCount !== 34 ||
    unavailableCount !== 2 ||
    evidenceTupleCount !== 306 ||
    knownConflictCount !== 13 ||
    nonConflictCount !== 21 ||
    falseExclusionCount !== 0 ||
    deterministicReplayCount !== 36 ||
    coveredReasonCodes.size !== 15
  ) {
    return reject();
  }

  return Object.freeze({
    caseCount: 36,
    assessmentCount: 34,
    unavailableCount: 2,
    evidenceTupleCount: 306,
    knownConflictCount: 13,
    nonConflictCount: 21,
    falseExclusionCount: 0,
    coveredReasonCodeCount: 15,
    deterministicReplayCount: 36,
    segmentCellCount: 6,
  });
}
