import type { CandidateDeletionRestoreConfiguration } from "./candidate-deletion-restore-contract.js";

const MAXIMUM_SECRET_BYTES = 16_384;
const SECRET_RESOLUTION_TIMEOUT_MS = 10_000;
const ENVELOPE_KEYS = new Set([
  "ARN",
  "Name",
  "VersionId",
  "VersionStages",
  "CreatedDate",
  "SecretString",
  "SecretBinary",
  "ResultMetadata",
]);

function rejected(): never {
  // No original error/cause, URL, password, secret body or extension token is exposed.
  throw new Error("CandidateDeletionRestoreDatabaseResolutionRejected");
}

function validCreatedDate(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  // The Go SDK's time.Time JSON uses RFC3339 with up to nanosecond precision.
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u.test(value)
  )
    return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    milliseconds > 0 &&
    new Date(milliseconds).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return rejected();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("CandidateDeletionRestoreDatabaseResolutionRejected"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function boundedEnvelope(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > MAXIMUM_SECRET_BYTES))
    rejected();
  if (!response.body) rejected();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) {
        complete = true;
        break;
      }
      if (
        !(chunk.value instanceof Uint8Array) ||
        chunk.value.byteLength === 0 ||
        chunks.length >= MAXIMUM_SECRET_BYTES
      )
        rejected();
      total += chunk.value.byteLength;
      if (total > MAXIMUM_SECRET_BYTES) rejected();
      chunks.push(chunk.value);
    }
    if (total === 0 || signal.aborted || (declared !== null && total !== Number(declared)))
      rejected();
    const bytes = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) rejected();
    const envelope = value as Record<string, unknown>;
    if (
      !Object.hasOwn(envelope, "SecretString") ||
      Object.keys(envelope).some((key) => !ENVELOPE_KEYS.has(key)) ||
      typeof envelope.SecretString !== "string"
    )
      rejected();
    return envelope;
  } finally {
    if (!complete) {
      // Never await an uncooperative stream's cancellation past the request deadline.
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

/** Resolve credentials in memory for the bound restore only; this function never opens SQL. */
export async function resolveRestoredDatabaseUrl(
  configuration: CandidateDeletionRestoreConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    if (signal.aborted) rejected();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) continue;
      if (
        (/^DATABASE_/iu.test(key) && key !== "DATABASE_SECRET_ID") ||
        /^PG/iu.test(key) ||
        key === "RESTORE_DATABASE_URL" ||
        /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_USE_ENV_PROXY|NODE_TLS_REJECT_UNAUTHORIZED)$/iu.test(
          key,
        )
      )
        rejected();
    }
    const { sourceHostname, targetHostname, accountId, region } = configuration;
    if (
      configuration.databaseName !== "ai_job_apply" ||
      configuration.databasePort !== 5432 ||
      region !== "us-east-2" ||
      !/^[0-9]{12}$/u.test(accountId) ||
      sourceHostname === targetHostname ||
      !/^ai-job-apply-development\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/u.test(
        sourceHostname,
      ) ||
      !/^ai-job-apply-development-restore-[0-9]{14}\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/u.test(
        targetHostname,
      ) ||
      sourceHostname !==
        `${configuration.sourceIdentifier}.${sourceHostname.split(".").slice(1).join(".")}` ||
      targetHostname !==
        `${configuration.targetIdentifier}.${targetHostname.split(".").slice(1).join(".")}`
    )
      rejected();
    const secretId = environment.DATABASE_SECRET_ID;
    const sessionToken = environment.AWS_SESSION_TOKEN;
    const expectedName = "ai-job-apply/development/database-url";
    if (
      !secretId ||
      !new RegExp(
        `^arn:aws:secretsmanager:${region}:${accountId}:secret:${expectedName}-[A-Za-z0-9]{6}$`,
        "u",
      ).test(secretId) ||
      !sessionToken ||
      sessionToken.length > 16_384 ||
      [...sessionToken].some(
        (character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126,
      )
    )
      rejected();
    const endpoint = new URL("http://localhost:2773/secretsmanager/get");
    endpoint.searchParams.set("secretId", secretId);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(SECRET_RESOLUTION_TIMEOUT_MS)]);
    const response = await abortable(
      fetcher(endpoint, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { "X-Aws-Parameters-Secrets-Token": sessionToken },
        signal: deadline,
      }),
      deadline,
    );
    if (
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== endpoint.toString())
    )
      rejected();
    const envelope = await boundedEnvelope(response, deadline);
    if (
      (envelope.ARN !== undefined && envelope.ARN !== secretId) ||
      (envelope.Name !== undefined && envelope.Name !== expectedName) ||
      (envelope.VersionId !== undefined &&
        (typeof envelope.VersionId !== "string" ||
          !/^[A-Za-z0-9_-]{32,64}$/u.test(envelope.VersionId))) ||
      (envelope.VersionStages !== undefined &&
        (!Array.isArray(envelope.VersionStages) ||
          envelope.VersionStages.length !== 1 ||
          envelope.VersionStages[0] !== "AWSCURRENT")) ||
      (envelope.CreatedDate !== undefined && !validCreatedDate(envelope.CreatedDate)) ||
      (envelope.SecretBinary !== undefined && envelope.SecretBinary !== null) ||
      (envelope.ResultMetadata !== undefined &&
        (envelope.ResultMetadata === null ||
          typeof envelope.ResultMetadata !== "object" ||
          Array.isArray(envelope.ResultMetadata) ||
          Object.keys(envelope.ResultMetadata).length !== 0))
    )
      rejected();
    // Terraform stores the URL itself, not a JSON object containing a URL.
    const value = envelope.SecretString as string;
    if (value.length > 4_096 || !/^[\x21-\x7e]+$/u.test(value)) rejected();
    const source = new URL(value);
    if (
      source.protocol !== "postgres:" ||
      source.username !== "platform" ||
      !source.password ||
      source.password.length > 1_024 ||
      !/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/u.test(source.password) ||
      source.hostname !== sourceHostname ||
      source.port !== "5432" ||
      source.pathname !== "/ai_job_apply" ||
      source.search !== "?sslmode=require" ||
      source.hash ||
      source.toString() !== value
    )
      rejected();
    const password = decodeURIComponent(source.password);
    if (
      [...password].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      rejected();
    source.hostname = targetHostname;
    if (
      source.hostname !== targetHostname ||
      source.hostname === sourceHostname ||
      deadline.aborted
    )
      rejected();
    return source.toString();
  } catch {
    return rejected();
  }
}
