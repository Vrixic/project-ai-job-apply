import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { readNativePrincipal } from "./native-principal.js";

const owner = "019a4000-0000-7000-8000-000000000001";
const issuer = "https://synthetic-issuer.invalid/";
function fixture(rows = [{ issuer, subject: "synthetic-candidate" }]) {
  const enabled = vi.fn(() => true);
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const tx = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: parts.join("?"), values });
    return calls.length === 1 ? [] : rows;
  };
  const begin = vi.fn(async (run: (value: unknown) => Promise<unknown>) => run(tx));
  const client = { begin } as unknown as postgres.Sql;
  return { client, begin, calls, enabled };
}
describe("private owning native principal projection", () => {
  it("checks active candidate and reads only exact owner/issuer without mutation", async () => {
    const f = fixture();
    await expect(readNativePrincipal(f.client, owner, issuer, f.enabled)).resolves.toEqual({
      issuer,
      subject: "synthetic-candidate",
    });
    expect(f.calls[0]?.text).toContain("identity.require_active_candidate");
    expect(f.calls[0]?.values).toEqual([owner]);
    expect(f.calls[1]?.values).toEqual([owner, issuer]);
    expect(f.calls[1]?.text).toContain("LIMIT 2 FOR SHARE");
    expect(f.calls[1]?.text).not.toMatch(/INSERT|UPDATE|DELETE|email|token/iu);
  });
  it.each(
    [
      [],
      [
        { issuer, subject: "a" },
        { issuer, subject: "b" },
      ],
      [{ issuer: "https://foreign.invalid/", subject: "a" }],
      [{ issuer, subject: "" }],
      [{ issuer, subject: "s".repeat(513) }],
    ].map((rows) => ({ rows })),
  )("refuses missing/ambiguous/mismatched principal %j", async ({ rows }) => {
    const f = fixture(rows);
    await expect(readNativePrincipal(f.client, owner, issuer, f.enabled)).rejects.toThrow(
      "NativePrincipalUnavailable",
    );
  });
  it.each([
    "http://issuer.invalid/",
    "https://issuer.invalid",
    "https://issuer.invalid/?x=1",
    "https://user@issuer.invalid/",
    "https://issuer.invalid/#x",
  ])("refuses unsafe issuer before SQL %s", async (value) => {
    const f = fixture();
    await expect(readNativePrincipal(f.client, owner, value, f.enabled)).rejects.toThrow(
      "NativePrincipalUnavailable",
    );
    expect(f.begin).not.toHaveBeenCalled();
  });
  it("refuses inactive candidate and hides SQL diagnostic values", async () => {
    const f = fixture();
    f.begin.mockRejectedValueOnce(Error("synthetic-private-identity"));
    await expect(readNativePrincipal(f.client, owner, issuer, f.enabled)).rejects.toThrow(
      /^NativePrincipalUnavailable$/u,
    );
  });
  it("withholds a result when disabled after transaction settlement", async () => {
    const f = fixture();
    f.begin.mockImplementationOnce(async (run) => {
      const value = await run(async () => [{ issuer, subject: "synthetic-candidate" }]);
      f.enabled.mockReturnValue(false);
      return value;
    });
    await expect(readNativePrincipal(f.client, owner, issuer, f.enabled)).rejects.toThrow(
      "NativePrincipalUnavailable",
    );
  });
});
