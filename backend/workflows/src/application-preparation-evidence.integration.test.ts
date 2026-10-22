import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ApplicationStoreOptions,
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { PostgresCoverLetterStore } from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  createProfileSectionStore,
  PostgresProfileStore,
} from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOwnedCoverLetterEvidenceSource } from "./application-preparation-evidence.js";

const { createSyntheticPacketProtection } = await import(
  new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const packetProtection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  destroy(): void;
};

const requested = process.env.OWNED_EVIDENCE_INTEGRATION === "1";
const databaseUrl = process.env.OWNED_EVIDENCE_TEST_DATABASE_URL;
if (requested) {
  const parsed = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    !/^\/owned_evidence_[a-z0-9_]{1,40}$/u.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  )
    throw Error("OwnedEvidenceIntegrationTargetRejected");
}
const execute = promisify(execFile);
const at = new Date("2026-10-02T12:00:00Z");

describe.skipIf(!requested)(
  "private evidence with real Profile/Jobs/Applications owner modules",
  () => {
    let database: ReturnType<typeof createDatabase>;
    let leaseDatabase: ReturnType<typeof createDatabase>;
    let jobsDatabase: ReturnType<typeof createJobCatalogDatabase>;
    let applicationsDatabase: ReturnType<typeof createApplicationsDatabase>;
    let profile: PostgresProfileStore;
    let profileSections: ReturnType<typeof createProfileSectionStore>;
    let catalog: PostgresJobCatalog;
    let applications: PostgresApplicationStore;
    let documents: PostgresCoverLetterStore;
    let source: ReturnType<typeof createOwnedCoverLetterEvidenceSource>;

    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of ["profile", "jobs", "applications", "documents"]) {
        await execute(
          process.execPath,
          [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
          { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl } },
        );
      }
      // Separate one-connection pools preserve owner-specific timestamp/row codecs and avoid
      // nested reads blocked behind the candidate lease.
      database = createDatabase(databaseUrl as string, { maxConnections: 1 });
      leaseDatabase = createDatabase(databaseUrl as string, { maxConnections: 1 });
      jobsDatabase = createJobCatalogDatabase(databaseUrl as string, { maxConnections: 1 });
      applicationsDatabase = createApplicationsDatabase(databaseUrl as string, {
        maxConnections: 1,
      });
      profile = new PostgresProfileStore(database);
      profileSections = createProfileSectionStore(database.client);
      catalog = new PostgresJobCatalog(jobsDatabase, {
        searchCursorKeys: { active: { id: "synthetic-v1", key: Buffer.alloc(32, 1) } },
      });
      applications = new PostgresApplicationStore(applicationsDatabase, () => at, {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: packetProtection.options,
      });
      documents = new PostgresCoverLetterStore(leaseDatabase.client, {
        putIfAbsent: async () => {
          throw Error("SyntheticUnexpectedObjectWrite");
        },
        read: async () => {
          throw Error("SyntheticUnexpectedObjectRead");
        },
      });
      source = createOwnedCoverLetterEvidenceSource({
        applications,
        profile: profileSections,
        catalog,
        candidateLease: documents,
        enabled: () => true,
        clock: () => at,
      });
    }, 90_000);
    afterAll(async () => {
      packetProtection.destroy();
      await database?.client.end();
      await leaseDatabase?.client.end();
      await jobsDatabase?.end();
      await applicationsDatabase?.end();
    });

    async function seed() {
      const user = await profile.resolveUser(
        {
          issuer: "https://synthetic-evidence.invalid/",
          subject: uuidv7(),
          audience: ["ai-job-apply-api"],
          scopes: [],
        },
        "synthetic",
      );
      const fact = await profileSections.createEntry(
        user.id,
        "skill",
        { name: "TypeScript" },
        uuidv7(),
        "synthetic",
      );
      const job = await catalog.recordObservation({
        provider: "greenhouse",
        provenance: "authorized_fixture",
        companyName: `Synthetic ${uuidv7()}`,
        title: "Engineer",
        locations: ["Remote - US"],
        description: "Build reliable systems with TypeScript.",
        sourceUrl: `https://jobs.example.test/${uuidv7()}`,
        observedAt: at,
        atsTenant: uuidv7(),
        externalJobId: uuidv7(),
        adapterVersion: "synthetic.v1",
      });
      const application = await applications.createApplication({
        ownerUserId: user.id,
        canonicalJobId: job.job.id,
        idempotencyKey: uuidv7(),
      });
      return { owner: user.id, fact, applicationId: application.view.application.id };
    }
    it("reads only the owned current Profile facts and the actual bound active posting", async () => {
      const first = await seed();
      const second = await seed();
      const result = await source.load(first.owner, first.applicationId);
      expect(result.facts.map((fact) => fact.id)).toEqual([first.fact.id]);
      expect(result.facts.map((fact) => fact.id)).not.toContain(second.fact.id);
      expect(result.job).toMatchObject({
        title: "Engineer",
        description: "Build reliable systems with TypeScript.",
      });
    });
    it("refuses a foreign application before Profile access", async () => {
      const first = await seed();
      const second = await seed();
      const read = vi.spyOn(profileSections, "listGroundingFacts");
      try {
        await expect(source.load(first.owner, second.applicationId)).rejects.toThrow(
          "CoverLetterEvidenceUnavailable",
        );
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    });
    it("refuses a quarantined candidate before any owner read", async () => {
      const first = await seed();
      await database.client`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${first.owner}`;
      const read = vi.spyOn(profileSections, "listGroundingFacts");
      const app = vi.spyOn(applications, "getApplication");
      try {
        await expect(source.load(first.owner, first.applicationId)).rejects.toThrow(
          "CoverLetterEvidenceUnavailable",
        );
        expect(read).not.toHaveBeenCalled();
        expect(app).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
        app.mockRestore();
      }
    });
  },
);
