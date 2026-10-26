/**
 * Whether a durable execution status response names exactly the expected function. The service returns the
 * version-qualified ARN of the execution's function (for example `...:function:name:19`); the unqualified base
 * of the same function is also accepted. Any other function, account, region or version is refused.
 */
export function durableFunctionArnMatches(actual: unknown, qualifiedFunctionArn: string): boolean {
  if (typeof actual !== "string") return false;
  return (
    actual === qualifiedFunctionArn || actual === qualifiedFunctionArn.replace(/:[1-9][0-9]*$/u, "")
  );
}
