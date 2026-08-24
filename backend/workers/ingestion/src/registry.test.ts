import { describe, expect, it, vi } from "vitest";
import type { IngestionSourceAdapter, SourceRuntimeGate } from "./contract.js";
import { SourceRegistry } from "./registry.js";

function adapter(): IngestionSourceAdapter {
  const poll: IngestionSourceAdapter["poll"] = async () => ({
    kind: "success",
    observations: [],
  });
  return {
    sourceId: "synthetic-foundation-v1",
    adapterVersion: "synthetic-ingestion-v1",
    poll: vi.fn(poll),
  };
}

describe("SourceRegistry", () => {
  it("keeps every source disabled unless explicitly enabled", () => {
    const registry = new SourceRegistry([
      {
        sourceId: "synthetic-foundation-v1",
        provider: "other",
        provenance: "authorized_fixture",
        adapter: adapter(),
      },
    ]);

    expect(registry.get("synthetic-foundation-v1")?.enabled).toBe(false);
    expect(() => registry.requireEnabled("synthetic-foundation-v1")).toThrow("disabled");
    expect(() => registry.requireEnabled("synthetic-absent-v1")).toThrow("disabled");
  });

  it("snapshots and freezes nested adapter descriptors", () => {
    const mutableAdapter = adapter() as {
      sourceId: string;
      adapterVersion: string;
      poll: IngestionSourceAdapter["poll"];
    };
    const registry = new SourceRegistry([
      {
        sourceId: "synthetic-foundation-v1",
        provider: "other",
        provenance: "authorized_fixture",
        adapter: mutableAdapter,
        enabled: true,
      },
    ]);
    mutableAdapter.sourceId = "synthetic-mutated-v1";
    mutableAdapter.adapterVersion = "synthetic-mutated-v1";

    const registration = registry.requireEnabled("synthetic-foundation-v1");
    expect(registration.adapter).toMatchObject({
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
    });
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.adapter)).toBe(true);
  });

  it("rejects duplicate, mismatched, malformed, and non-synthetic registrations", () => {
    const valid = {
      sourceId: "synthetic-foundation-v1",
      provider: "other" as const,
      provenance: "authorized_fixture" as const,
      adapter: adapter(),
    };
    expect(() => new SourceRegistry([valid, valid])).toThrow("unique");
    expect(
      () => new SourceRegistry([{ ...valid, sourceId: "synthetic-other-v1", adapter: adapter() }]),
    ).toThrow("descriptor");
    expect(
      () => new SourceRegistry([{ ...valid, sourceId: "INVALID", adapter: adapter() }]),
    ).toThrow("canonical source identifier");
    expect(() => new SourceRegistry([{ ...valid, provenance: "permitted_api" }])).toThrow(
      "default-off",
    );
  });

  it.each([
    ["greenhouse", "greenhouse-reviewed-board", "greenhouse-job-board-v1"],
    ["lever", "lever-reviewed-site", "lever-postings-v1"],
    ["ashby", "ashby-reviewed-board", "ashby-job-board-v1"],
  ] as const)(
    "admits the exact %s shape as disabled and requires explicit activation authority",
    (provider, sourceId, adapterVersion) => {
      const providerAdapter: IngestionSourceAdapter = {
        sourceId,
        adapterVersion,
        poll: vi.fn(async () => ({ kind: "success" as const, observations: [] })),
      };
      const registry = new SourceRegistry([
        {
          sourceId,
          provider,
          provenance: "permitted_api",
          adapter: providerAdapter,
        },
      ]);
      expect(registry.get(sourceId)).toMatchObject({ enabled: false });
      expect(() => registry.requireEnabled(sourceId)).toThrow("disabled");
      expect(
        () =>
          new SourceRegistry([
            {
              sourceId,
              provider,
              provenance: "permitted_api",
              adapter: providerAdapter,
              enabled: true,
            },
          ]),
      ).toThrow("default-off");
      const enabled = new SourceRegistry(
        [
          {
            sourceId,
            provider,
            provenance: "permitted_api",
            adapter: providerAdapter,
            enabled: true,
          },
        ],
        () => true,
        { providerActivationAllowed: true },
      );
      expect(enabled.requireEnabled(sourceId)).toMatchObject({ enabled: true, provider });
    },
  );

  it("rejects provider/source-prefix mismatches for every dark ATS candidate", () => {
    const providerAdapter: IngestionSourceAdapter = {
      sourceId: "lever-reviewed-site",
      adapterVersion: "lever-postings-v1",
      poll: vi.fn(async () => ({ kind: "success" as const, observations: [] })),
    };
    expect(
      () =>
        new SourceRegistry([
          {
            sourceId: "lever-reviewed-site",
            provider: "ashby",
            provenance: "permitted_api",
            adapter: providerAdapter,
          },
        ]),
    ).toThrow("default-off");
  });

  it("rechecks a dynamic activation gate instead of caching its first decision", () => {
    let active = true;
    const runtimeGate: SourceRuntimeGate = () => active;
    const registry = new SourceRegistry(
      [
        {
          sourceId: "synthetic-foundation-v1",
          provider: "other",
          provenance: "authorized_fixture",
          adapter: adapter(),
          enabled: true,
        },
      ],
      runtimeGate,
    );
    expect(registry.requireEnabled("synthetic-foundation-v1")).toBeDefined();
    active = false;
    expect(() => registry.requireEnabled("synthetic-foundation-v1")).toThrow("disabled");
  });
});
