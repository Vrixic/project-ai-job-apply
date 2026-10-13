import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import { PostgresNativeResumeRequestStore } from "./native-resume-request-store.js";

const workflow = (version: number) =>
  `arn:aws:lambda:us-east-2:123456789012:function:resume-durable:${version}`;
function setup() {
  const tx = vi.fn((input: unknown, ..._values: unknown[]) =>
    Array.isArray(input) && "raw" in input ? Promise.resolve([]) : { retained: input },
  );
  const begin = vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx));
  const store = new PostgresNativeResumeRequestStore(
    { begin } as unknown as postgres.Sql,
    () => true,
  );
  return { store, begin, tx };
}

it("passes all nine original workflow versions to the existing bounded observation claim", async () => {
  const x = setup();
  const versions = Array.from({ length: 9 }, (_unused, index) => workflow(index + 1));

  await expect(x.store.claimExecutionObservations(versions)).resolves.toEqual([]);

  expect(x.begin).toHaveBeenCalledOnce();
  expect(x.tx.mock.calls[0]?.[0]).toEqual(versions);
});

it.each<[string, string[]]>([
  ["empty", []],
  ["ten versions", Array.from({ length: 10 }, (_unused, index) => workflow(index + 1))],
  ["duplicate", [workflow(1), workflow(1)]],
  ["alias", [workflow(1).replace(/:1$/u, ":development")]],
  ["foreign region", [workflow(1).replace("us-east-2", "us-west-2")]],
])("rejects a %s observation allowlist before SQL", async (_label, workflows) => {
  const x = setup();

  await expect(x.store.claimExecutionObservations(workflows)).rejects.toThrow(
    "NativeResumeRequestUnavailable",
  );

  expect(x.begin).not.toHaveBeenCalled();
  expect(x.tx).not.toHaveBeenCalled();
});
