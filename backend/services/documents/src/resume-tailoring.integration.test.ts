import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresParsedResumeSource } from "./resume-tailoring.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresParsedResumeSource", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const source = new PostgresParsedResumeSource(client);

  beforeAll(async () => {
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    for (const migration of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      await execFileAsync(process.execPath, [fileURLToPath(new URL(migration, import.meta.url))], {
        env: environment,
      });
    }
  });

  afterAll(async () => {
    await client.end();
  });

  async function insertResume(
    userId: string,
    options: {
      status?: string;
      securityHold?: boolean;
      updatedAt: string;
      fileName?: string;
    },
  ): Promise<string> {
    const id = crypto.randomUUID();
    const sha = "a".repeat(64);
    const parsed = (options.status ?? "parsed") === "parsed";
    await client`
      INSERT INTO documents.resume_documents (
        id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status,
        parser_version, normalized_object_key, normalized_object_version, normalized_sha256,
        page_count, character_count, security_hold, failure_code, created_at, updated_at
      ) VALUES (
        ${id}, ${userId}, ${options.fileName ?? "synthetic.pdf"}, 'application/pdf', 1024, ${sha},
        ${`quarantine/${id}/source`}, ${options.status ?? "parsed"}, ${parsed ? "parser-1" : null},
        ${parsed ? `normalized/${id}/${sha}/parser-1/resume.json` : null},
        ${parsed ? "nv1" : null}, ${parsed ? "b".repeat(64) : null},
        ${parsed ? 1 : null}, ${parsed ? 500 : null}, ${options.securityHold ?? false},
        ${options.status === "failed" ? "parse_failed" : null}, ${options.updatedAt}, ${options.updatedAt}
      )`;
    return id;
  }

  it("returns the owner's newest parsed resume and nothing that is held, unparsed, or foreign", async () => {
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${owner}), (${other})`;
    try {
      expect(await source.findParsedResume(owner)).toBeNull();

      const older = await insertResume(owner, {
        updatedAt: "2026-09-01T00:00:00Z",
        fileName: "older.pdf",
      });
      const newer = await insertResume(owner, {
        updatedAt: "2026-09-10T00:00:00Z",
        fileName: "newer.pdf",
      });
      // None of these may ever be selected, however recent.
      await insertResume(owner, { updatedAt: "2026-09-18T00:00:00Z", securityHold: true });
      await insertResume(owner, { updatedAt: "2026-09-18T00:00:00Z", status: "parsing" });
      await insertResume(owner, { updatedAt: "2026-09-18T00:00:00Z", status: "failed" });
      await insertResume(other, { updatedAt: "2026-09-19T00:00:00Z", fileName: "foreign.pdf" });

      const latest = await source.findParsedResume(owner);
      expect(latest).toMatchObject({
        id: newer,
        fileName: "newer.pdf",
        parserVersion: "parser-1",
        normalizedObjectVersion: "nv1",
        normalizedSha256: "b".repeat(64),
      });
      expect(latest?.normalizedObjectKey).toBe(
        `normalized/${newer}/${"a".repeat(64)}/parser-1/resume.json`,
      );

      // An explicit document id is honoured only within the owner's own documents.
      expect((await source.findParsedResume(owner, older))?.id).toBe(older);
      expect(await source.findParsedResume(other, older)).toBeNull();
      expect(await source.findParsedResume(owner, crypto.randomUUID())).toBeNull();
    } finally {
      await client`DELETE FROM identity.users WHERE id IN (${owner}, ${other})`;
    }
  });
});
