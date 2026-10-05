import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createCoverLetterDocument,
  createCoverLetterExportReader,
  encodeCoverLetterDocument,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCandidateRightsActivityStore } from "./candidate-rights-activities.js";

const requested = process.env.COVER_LETTER_EXPORT_INTEGRATION === "1";
const url = process.env.COVER_LETTER_EXPORT_TEST_DATABASE_URL ?? "postgres://invalid";
if (requested) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/cover_letter_export_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("CoverLetterExportIntegrationTargetRejected");
}
const execute = promisify(execFile);
describe.skipIf(!requested)(
  "saved cover letters through real owner-scoped candidate export",
  () => {
    const database = createDatabase(url, { maxConnections: 1 });
    const readers: Array<{ close: () => Promise<void> }> = [];
    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of [
        "profile",
        "documents",
        "jobs",
        "matching",
        "billing",
        "trust",
        "applications",
      ]) {
        const path = fileURLToPath(
          new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url),
        );
        const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url } };
        const first = await execute(process.execPath, [path], options);
        expect((await execute(process.execPath, [path], options)).stdout).toBe(first.stdout);
      }
    }, 90000);
    afterAll(async () => {
      await Promise.all(readers.map((reader) => reader.close()));
      await database.client.end();
    });
    it.each([
      "ready",
      "missing",
      "corrupt",
      "foreign_owner",
      "quarantined",
      "withdrawn",
      "legacy",
    ] as const)("exports the exact saved inventory: %s", async (fault) => {
      const now = new Date();
      const owner = uuidv7();
      const neighbor = uuidv7();
      const applicationId = uuidv7();
      const factId = uuidv7();
      await database.client`INSERT INTO identity.users (id) VALUES (${owner}), (${neighbor})`;
      const policy: CandidateRightsPolicy = {
        version: "synthetic-cover-letter-export-v1",
        accountablePolicySha256: "a".repeat(64),
        exportArtifactLifetimeSeconds: 3600,
        downloadGrantLifetimeSeconds: 300,
        backupRetentionDays: 35,
        recentAuthenticationMaxAgeSeconds: 300,
        ownerInventory: [
          "identity",
          "profile",
          "documents",
          "jobs",
          "matching",
          "billing",
          "trust",
          "applications",
        ],
        subprocessorInventory: [],
      };
      const profile = new PostgresProfileStore(database, {
        candidateRightsPolicy: policy,
        clock: () => now,
      });
      const principal = {
        issuer: "https://synthetic-export.invalid/",
        subject: `synthetic-${owner}`,
        audience: ["synthetic-export"],
        scopes: ["profile:export"],
        authenticatedAt: Math.floor(now.getTime() / 1000),
      };
      const accepted = await profile.createCandidateDataExport(
        principal,
        owner,
        uuidv7(),
        uuidv7(),
      );
      const record = await profile.getCandidateDataExport(owner, accepted.id);
      if (!record) throw Error("SyntheticExportRecordMissing");
      const objects = new Map<string, Uint8Array>();
      const ids: string[] = [];
      const hashes: string[] = [];
      const generation = {
        status: "needs_review" as const,
        purpose: "cover_letter" as const,
        reviewRequired: true as const,
        paragraphs: [{ text: "I build reliable synthetic systems.", factIds: [factId] }],
        findings: [],
        sourceFactIds: [factId],
        confidence: 1,
        promptVersion: "1.0.0",
        model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
      };
      for (const [userId, version] of [
        [owner, 1],
        [owner, 2],
        [neighbor, 1],
      ] as const) {
        const id = uuidv7();
        const key = `normalized/${id}/cover-letter.v1.json`;
        const document = createCoverLetterDocument(
          {
            id,
            ownerUserId: userId,
            applicationId,
            version,
            jobRevision: "a".repeat(64),
            confirmedFactsHash: "b".repeat(64),
          },
          generation,
          now,
        );
        const bytes = encodeCoverLetterDocument(
          fault === "foreign_owner" && userId === owner
            ? { ...document, ownerUserId: neighbor }
            : document,
        );
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await database.client`INSERT INTO documents.cover_letters (id, user_id, application_id, version, job_revision, confirmed_facts_hash, object_key, object_version, object_sha256, content_sha256, size_bytes, prompt_version, status, created_at) VALUES (${id}, ${userId}, ${applicationId}, ${version}, ${document.jobRevision}, ${document.confirmedFactsHash}, ${key}, 'synthetic-version', ${sha256}, ${document.contentSha256}, ${bytes.byteLength}, ${document.promptVersion}, 'ready', ${now.toISOString()}::timestamptz)`;
        objects.set(key, bytes);
        if (userId === owner) {
          ids.push(id);
          hashes.push(document.contentSha256);
        }
      }
      expect(new Set(hashes).size).toBe(1);
      const pending = uuidv7();
      await database.client`INSERT INTO documents.cover_letters (id,user_id,application_id,version,job_revision,confirmed_facts_hash,object_key) VALUES (${pending},${owner},${applicationId},3,${"a".repeat(64)},${"b".repeat(64)},${`normalized/${pending}/cover-letter.v1.json`})`;
      let enabled = true;
      const readIds: string[] = [];
      const written: Uint8Array[] = [];
      const native = createCoverLetterExportReader(
        url,
        {
          read: async (input) => {
            expect(ids).toContain(input.documentId);
            readIds.push(input.documentId);
            expect(input.objectVersion).toBe("synthetic-version");
            if (fault === "missing") throw Error("SyntheticMissingSavedObject");
            const bytes = objects.get(input.objectKey);
            if (!bytes) throw Error("SyntheticObjectMissing");
            if (fault === "withdrawn") enabled = false;
            return fault === "corrupt" ? new Uint8Array(bytes.byteLength) : Uint8Array.from(bytes);
          },
        },
        () => enabled,
      );
      readers.push(native);
      const forbidden = async (): Promise<never> => {
        throw Error("SyntheticUnexpectedExternalMutation");
      };
      const activities = new PostgresCandidateRightsActivityStore({
        database,
        policy,
        clock: () => now,
        artifactStore: {
          putIfAbsent: async ({ body, sha256 }) => {
            expect(createHash("sha256").update(body).digest("hex")).toBe(sha256);
            written.push(Uint8Array.from(body));
            return { objectVersion: "synthetic-export-version" };
          },
        },
        ...(fault === "legacy"
          ? {}
          : {
              coverLetterExport: {
                readValue: async (...args) => {
                  if (fault === "quarantined")
                    await database.client`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${owner}`;
                  return native.reader.readValue(...args);
                },
              },
            }),
        documentObjectStore: { deleteAllVersionsAndMarkers: forbidden },
        identityProvider: { revokeAndDelete: forbidden },
        subprocessors: [],
        recoveryLedger: { recordConfirmed: forbidden, markCompleted: forbidden },
      });
      const input = {
        schemaVersion: 1 as const,
        workflowDefinitionVersion: 1 as const,
        action: "export_begin" as const,
        eventId: uuidv7(),
        resourceId: record.id,
        operationId: record.operationId,
        policyVersion: policy.version,
      };
      await activities.beginExport(input);
      const refused = !["ready", "legacy"].includes(fault);
      if (refused) {
        await expect(
          activities.assembleExport({ ...input, action: "export_assemble" }),
        ).rejects.toThrow();
        expect(written).toHaveLength(0);
        if (fault === "quarantined") expect(readIds).toHaveLength(0);
      } else {
        await activities.assembleExport({ ...input, action: "export_assemble" });
        await activities.assembleExport({ ...input, action: "export_assemble" });
        expect(written).toHaveLength(1);
        const serialized = Buffer.from(written[0] ?? []).toString("utf8");
        const exported = JSON.parse(serialized);
        expect(validateCandidateDataExportV1(exported)).toBe(true);
        expect(exported.documents.coverLetters).toHaveLength(3);
        const ready = exported.documents.coverLetters.filter(
          (entry: { status: string }) => entry.status === "ready",
        );
        expect(new Set(ready.map((entry: { id: string }) => entry.id))).toEqual(new Set(ids));
        expect(ready.map((entry: { paragraphs?: unknown }) => entry.paragraphs)).toEqual(
          fault === "legacy"
            ? [undefined, undefined]
            : [generation.paragraphs, generation.paragraphs],
        );
        expect(
          exported.documents.coverLetters.find((entry: { id: string }) => entry.id === pending)
            .paragraphs,
        ).toBeUndefined();
        expect(serialized).not.toContain(neighbor);
        expect(serialized).not.toContain("normalized/");
        expect(serialized).not.toContain("objectVersion");
        expect(readIds).toHaveLength(fault === "legacy" ? 0 : 2);
      }
    });
  },
);
