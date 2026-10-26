/**
 * Fixed-format fields that say why a step failed without carrying a message, a key, or an identifier: the error name, a
 * PostgreSQL SQLSTATE, the PL/pgSQL function that raised it, an AWS error code, and an HTTP status, each only when it
 * has the expected shape. Used where a failure is retried and would otherwise leave no trace.
 */
export function failureFields(error: unknown): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  if (typeof error !== "object" || error === null) return fields;
  const value = error as {
    name?: unknown;
    code?: unknown;
    Code?: unknown;
    where?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (typeof value.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(value.name)) {
    fields.errorName = value.name;
  }
  if (typeof value.code === "string" && /^[0-9A-Z]{5}$/u.test(value.code))
    fields.sqlState = value.code;
  // PostgreSQL context such as "PL/pgSQL function documents.guard() line 6 at RAISE": only the function name is kept.
  if (typeof value.where === "string") {
    const fn = /PL\/pgSQL function ([a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62})\(/u.exec(
      value.where,
    );
    if (fn?.[1]) fields.sqlFunction = fn[1];
  }
  const awsCode = typeof value.Code === "string" ? value.Code : value.code;
  if (typeof awsCode === "string" && /^[A-Za-z][A-Za-z0-9_]{1,63}$/u.test(awsCode))
    fields.errorReason = awsCode;
  const status = value.$metadata?.httpStatusCode;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    fields.httpStatus = status;
  }
  return fields;
}
