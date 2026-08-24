import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const readerRole = "ai_job_apply_public_job_reader";

describeWithDatabase("dedicated public job reader boundary", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", { max: 2 });
  const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
  const companyId = uuidv7();
  const canonicalJobId = uuidv7();
  const aliasJobId = uuidv7();
  let createdRdsIamRole = false;

  async function runMigrationVerifier() {
    return execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  }

  async function asReader<T extends Record<string, unknown>>(statement: string): Promise<T[]> {
    let rows: T[] = [];
    await client.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL ROLE ${readerRole}`);
      rows = (await transaction.unsafe<Record<string, unknown>[]>(statement)) as unknown as T[];
    });
    return rows;
  }

  async function expectReaderDenied(statement: string): Promise<void> {
    await expect(asReader(statement)).rejects.toThrow(/permission denied/i);
  }

  beforeAll(async () => {
    const [rdsIam] = await client<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rds_iam') AS present
    `;
    if (!rdsIam?.present) {
      await client.unsafe("CREATE ROLE rds_iam NOLOGIN");
      createdRdsIamRole = true;
      const [migrationLedger] = await client<{ present: boolean }[]>`
        SELECT to_regclass('jobs.schema_migrations') IS NOT NULL AS present
      `;
      const [publicBoundaryAlreadyApplied] = migrationLedger?.present
        ? await client<{ applied: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM jobs.schema_migrations WHERE version='0006_public_job_reader'
            ) AS applied
          `
        : [{ applied: false }];
      if (publicBoundaryAlreadyApplied?.applied) {
        await client.unsafe(
          `GRANT rds_iam TO ${readerRole} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
        );
      }
    }
    const first = await runMigrationVerifier();
    const replay = await runMigrationVerifier();
    expect(first.stdout.trim()).toBe(
      "Jobs migrations through 0009_provider_ingestion_sources applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Jobs migrations through 0009_provider_ingestion_sources applied and verified.",
    );

    await client`
      INSERT INTO jobs.companies (id, display_name, normalized_name, verified_domain)
      VALUES (${companyId}, 'Public Synthetic Company', 'public synthetic company',
        'private.synthetic.example.test')
    `;
    for (const [id, title] of [
      [canonicalJobId, "Canonical <script>alert(1)</script> role"],
      [aliasJobId, "Alias role"],
    ] as const) {
      await client`
        INSERT INTO jobs.canonical_jobs (
          id, company_id, title, normalized_title, locations, normalized_locations,
          department, normalized_department, description, description_hash,
          dedupe_fingerprint, status, status_reason, first_observed_at, last_verified_at,
          expires_at, valid_through
        ) VALUES (
          ${id}, ${companyId}, ${title}, ${title.toLowerCase()},
          ${client.json(["Remote, US"])}::jsonb, ${["remote, us"] as string[]},
          'Engineering', 'engineering', 'Synthetic public description.', ${"a".repeat(64)},
          ${`public-${id}`}, 'active', NULL, '2026-08-14T12:00:00.000Z'::timestamptz,
          '2026-08-15T11:00:00.000Z'::timestamptz,
          '2099-09-15T12:00:00.000Z'::timestamptz,
          '2099-09-01T12:00:00.000Z'::timestamptz
        )
      `;
    }
    const jobId = canonicalJobId < aliasJobId ? canonicalJobId : aliasJobId;
    const candidateJobId = canonicalJobId < aliasJobId ? aliasJobId : canonicalJobId;
    await client`
      INSERT INTO jobs.duplicate_candidates (
        job_id, candidate_job_id, classification, fingerprint, reviewed_at, resolution,
        canonical_job_id, reviewed_by, review_reason_code, resolution_version
      ) VALUES (
        ${jobId}, ${candidateJobId}, 'exact', ${`public-alias-${aliasJobId}`},
        '2026-08-16T11:30:00.000Z'::timestamptz, 'exact', ${canonicalJobId},
        'operator:public-reader-test', 'synthetic.public_reader_alias', 1
      )
    `;
    await client.unsafe("CREATE SCHEMA public_reader_private_test");
    await client.unsafe(
      "CREATE TABLE public_reader_private_test.secret_values (secret text NOT NULL)",
    );
    await client.unsafe(
      "INSERT INTO public_reader_private_test.secret_values (secret) VALUES ('private-value')",
    );
  });

  afterAll(async () => {
    await client`
      DELETE FROM jobs.duplicate_candidates
      WHERE job_id IN (${canonicalJobId}, ${aliasJobId})
        OR candidate_job_id IN (${canonicalJobId}, ${aliasJobId})
    `;
    await client`
      DELETE FROM jobs.canonical_jobs WHERE id IN (${canonicalJobId}, ${aliasJobId})
    `;
    await client`DELETE FROM jobs.companies WHERE id = ${companyId}`;
    await client.unsafe("DROP SCHEMA IF EXISTS public_reader_private_test CASCADE");
    if (createdRdsIamRole) {
      const [membership] = await client<{ present: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_auth_members
          WHERE roleid='rds_iam'::regrole AND member=${readerRole}::regrole
        ) AS present
      `;
      if (membership?.present) {
        await client.unsafe(`REVOKE rds_iam FROM ${readerRole}`);
      }
      await client.unsafe("DROP ROLE rds_iam");
    }
    await client.end();
  });

  it("projects the exact public fields for canonical and reversible alias identifiers", async () => {
    const canonical = await asReader<Record<string, unknown>>(
      `SELECT * FROM jobs_public.read_public_job_detail('${canonicalJobId}'::uuid)`,
    );
    const alias = await asReader<Record<string, unknown>>(
      `SELECT * FROM jobs_public.read_public_job_detail('${aliasJobId}'::uuid)`,
    );

    expect(canonical).toHaveLength(1);
    expect(alias).toEqual(canonical);
    expect(Object.keys(canonical[0] ?? {}).sort()).toEqual(
      [
        "company_name",
        "department",
        "description",
        "expires_at",
        "first_observed_at",
        "id",
        "last_verified_at",
        "locations",
        "status",
        "title",
        "valid_through",
      ].sort(),
    );
    expect(canonical[0]).toMatchObject({
      id: canonicalJobId,
      company_name: "Public Synthetic Company",
      title: "Canonical <script>alert(1)</script> role",
      locations: ["Remote, US"],
      status: "active",
    });
    expect(canonical[0]).not.toHaveProperty("verified_domain");
    expect(canonical[0]).not.toHaveProperty("status_reason");
    expect(canonical[0]).not.toHaveProperty("raw_snapshot");
  });

  it("has only the reviewed application-database grants", async () => {
    const rows = await client<
      Array<{
        connect: boolean;
        temporary: boolean;
        createDatabaseObject: boolean;
        publicSchema: boolean;
        jobsSchema: boolean;
        projectionSchema: boolean;
        projectionFunction: boolean;
        catalogTable: boolean;
      }>
    >`
      SELECT
        has_database_privilege(${readerRole}, current_database(), 'CONNECT') AS connect,
        has_database_privilege(${readerRole}, current_database(), 'TEMPORARY') AS temporary,
        has_database_privilege(${readerRole}, current_database(), 'CREATE') AS "createDatabaseObject",
        has_schema_privilege(${readerRole}, 'public', 'USAGE') AS "publicSchema",
        has_schema_privilege(${readerRole}, 'jobs', 'USAGE') AS "jobsSchema",
        has_schema_privilege(${readerRole}, 'jobs_public', 'USAGE') AS "projectionSchema",
        has_function_privilege(
          ${readerRole}, 'jobs_public.read_public_job_detail(uuid)', 'EXECUTE'
        ) AS "projectionFunction",
        has_table_privilege(${readerRole}, 'jobs.canonical_jobs', 'SELECT') AS "catalogTable"
    `;
    expect(rows).toEqual([
      {
        connect: true,
        temporary: false,
        createDatabaseObject: false,
        publicSchema: false,
        jobsSchema: false,
        projectionSchema: true,
        projectionFunction: true,
        catalogTable: false,
      },
    ]);

    const [role] = await client<
      Array<{
        canLogin: boolean;
        inherit: boolean;
        superuser: boolean;
        createDb: boolean;
        createRole: boolean;
        replication: boolean;
        bypassRls: boolean;
        connectionLimit: number;
      }>
    >`
      SELECT rolcanlogin AS "canLogin", rolinherit AS inherit, rolsuper AS superuser,
        rolcreatedb AS "createDb", rolcreaterole AS "createRole",
        rolreplication AS replication, rolbypassrls AS "bypassRls",
        rolconnlimit AS "connectionLimit"
      FROM pg_roles WHERE rolname = ${readerRole}
    `;
    expect(role).toEqual({
      canLogin: true,
      inherit: false,
      superuser: false,
      createDb: false,
      createRole: false,
      replication: false,
      bypassRls: false,
      connectionLimit: 1,
    });

    const passwordAndMembership = await client<
      Array<{
        passwordIsNull: boolean;
        safeRdsIamMemberships: number;
        unexpectedMemberships: number;
      }>
    >`
      SELECT
        (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = ${readerRole})
          AS "passwordIsNull",
        (
          SELECT count(*)::int FROM pg_auth_members AS membership
          WHERE membership.member=${readerRole}::regrole
            AND membership.roleid='rds_iam'::regrole
            AND NOT membership.admin_option
            AND NOT membership.inherit_option
            AND NOT membership.set_option
        ) AS "safeRdsIamMemberships",
        (
          SELECT count(*)::int
          FROM (
            SELECT membership.roleid, membership.member
            FROM pg_auth_members AS membership
            INNER JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
            WHERE membership.member = ${readerRole}::regrole
              AND NOT (
                granted_role.rolname='rds_iam'
                AND NOT membership.admin_option
                AND NOT membership.inherit_option
                AND NOT membership.set_option
              )
            UNION ALL
            SELECT membership.roleid, membership.member
            FROM pg_auth_members AS membership
            WHERE membership.roleid = ${readerRole}::regrole
          ) AS unexpected
        ) AS "unexpectedMemberships"
    `;
    expect(passwordAndMembership).toEqual([
      { passwordIsNull: true, safeRdsIamMemberships: 1, unexpectedMemberships: 0 },
    ]);
  });

  it("configures application-database reader sessions as read-only", async () => {
    const settings = await client<{ setting: string }[]>`
      SELECT unnest(role_setting.setconfig) AS setting
      FROM pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = ${readerRole}::regrole
        AND role_setting.setdatabase = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
    `;
    expect(settings).toContainEqual({ setting: "default_transaction_read_only=on" });
    await expect(
      client.begin(async (transaction) => {
        await transaction.unsafe("SET TRANSACTION READ ONLY");
        await transaction.unsafe(`SET LOCAL ROLE ${readerRole}`);
        await transaction`SELECT lo_create(0)`;
      }),
    ).rejects.toMatchObject({ code: "25006" });
  });

  it("clears password drift and rejects unexpected direct role membership", async () => {
    await client.unsafe(`ALTER ROLE ${readerRole} PASSWORD 'synthetic-password-drift'`);
    await expect(runMigrationVerifier()).resolves.toMatchObject({
      stdout: expect.stringContaining("0009_provider_ingestion_sources applied and verified"),
    });
    const [afterPasswordRepair] = await client<{ passwordIsNull: boolean }[]>`
      SELECT rolpassword IS NULL AS "passwordIsNull"
      FROM pg_authid WHERE rolname=${readerRole}
    `;
    expect(afterPasswordRepair?.passwordIsNull).toBe(true);

    await client.unsafe("CREATE ROLE public_job_reader_unexpected_group NOLOGIN");
    await client.unsafe(`GRANT public_job_reader_unexpected_group TO ${readerRole}`);
    try {
      await expect(runMigrationVerifier()).rejects.toThrow();
    } finally {
      await client.unsafe(`REVOKE public_job_reader_unexpected_group FROM ${readerRole}`);
      await client.unsafe("DROP ROLE public_job_reader_unexpected_group");
    }
    await expect(runMigrationVerifier()).resolves.toMatchObject({
      stdout: expect.stringContaining("0009_provider_ingestion_sources applied and verified"),
    });

    await client.unsafe(`GRANT rds_iam TO ${readerRole} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    try {
      await expect(runMigrationVerifier()).rejects.toThrow();
    } finally {
      await client.unsafe(
        `GRANT rds_iam TO ${readerRole} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
      );
    }
    await expect(runMigrationVerifier()).resolves.toMatchObject({
      stdout: expect.stringContaining("0009_provider_ingestion_sources applied and verified"),
    });

    await client.unsafe("CREATE ROLE public_job_reader_secondary_grantor NOLOGIN");
    await client.unsafe("GRANT rds_iam TO public_job_reader_secondary_grantor WITH ADMIN TRUE");
    try {
      await client.unsafe("SET ROLE public_job_reader_secondary_grantor");
      try {
        await client.unsafe(
          `GRANT rds_iam TO ${readerRole} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
        );
      } finally {
        await client.unsafe("RESET ROLE");
      }
      await expect(runMigrationVerifier()).rejects.toThrow();
    } finally {
      await client.unsafe("SET ROLE public_job_reader_secondary_grantor");
      try {
        await client.unsafe(`REVOKE rds_iam FROM ${readerRole}`);
      } finally {
        await client.unsafe("RESET ROLE");
      }
      await client.unsafe("REVOKE rds_iam FROM public_job_reader_secondary_grantor");
      await client.unsafe("DROP ROLE public_job_reader_secondary_grantor");
    }
    await expect(runMigrationVerifier()).resolves.toMatchObject({
      stdout: expect.stringContaining("0009_provider_ingestion_sources applied and verified"),
    });
  });

  it("rejects direct privilege and object-ownership drift anywhere in the application database", async () => {
    await client.unsafe(`GRANT USAGE ON SCHEMA public_reader_private_test TO ${readerRole}`);
    try {
      await expect(runMigrationVerifier()).rejects.toThrow();
    } finally {
      await client.unsafe(`REVOKE USAGE ON SCHEMA public_reader_private_test FROM ${readerRole}`);
    }

    await client.unsafe(
      `ALTER TABLE public_reader_private_test.secret_values OWNER TO ${readerRole}`,
    );
    try {
      await expect(runMigrationVerifier()).rejects.toThrow();
    } finally {
      await client.unsafe(
        "ALTER TABLE public_reader_private_test.secret_values OWNER TO CURRENT_USER",
      );
    }
    await expect(runMigrationVerifier()).resolves.toMatchObject({
      stdout: expect.stringContaining("0009_provider_ingestion_sources applied and verified"),
    });
  });

  it("suppresses nonpublic lifecycle and chronology before returning projection fields", async () => {
    const unavailableStates = ["pending", "suspect_stale", "withdrawn", "blocked"] as const;
    try {
      for (const status of unavailableStates) {
        await client`
          UPDATE jobs.canonical_jobs SET status = ${status} WHERE id = ${canonicalJobId}
        `;
        await expect(
          asReader(`SELECT * FROM jobs_public.read_public_job_detail('${canonicalJobId}'::uuid)`),
        ).resolves.toEqual([]);
        await expect(
          asReader(`SELECT * FROM jobs_public.read_public_job_detail('${aliasJobId}'::uuid)`),
        ).resolves.toEqual([]);
      }

      await client`
        UPDATE jobs.canonical_jobs
        SET status='active', expires_at='2026-08-16T00:00:00.000Z'::timestamptz,
          valid_through=NULL
        WHERE id=${canonicalJobId}
      `;
      await expect(
        asReader(`SELECT * FROM jobs_public.read_public_job_detail('${canonicalJobId}'::uuid)`),
      ).resolves.toEqual([]);

      await client`
        UPDATE jobs.canonical_jobs
        SET expires_at='2099-09-15T12:00:00.000Z'::timestamptz,
          valid_through='2099-09-16T12:00:00.000Z'::timestamptz
        WHERE id=${canonicalJobId}
      `;
      await expect(
        asReader(`SELECT * FROM jobs_public.read_public_job_detail('${canonicalJobId}'::uuid)`),
      ).resolves.toEqual([]);
    } finally {
      await client`
        UPDATE jobs.canonical_jobs
        SET status='active', expires_at='2099-09-15T12:00:00.000Z'::timestamptz,
          valid_through='2099-09-01T12:00:00.000Z'::timestamptz
        WHERE id=${canonicalJobId}
      `;
    }
  });

  it("refuses direct catalog, raw-source, other-schema, public-schema, temp, and writes", async () => {
    for (const statement of [
      "SELECT id FROM jobs.canonical_jobs LIMIT 1",
      "SELECT raw_snapshot FROM jobs.job_sources LIMIT 1",
      "SELECT secret FROM public_reader_private_test.secret_values",
      "CREATE TABLE public.reader_escape (value text)",
      "CREATE TEMP TABLE reader_escape (value text)",
      `INSERT INTO jobs.canonical_jobs (id) VALUES ('${uuidv7()}')`,
      `UPDATE jobs.canonical_jobs SET title = 'changed' WHERE id = '${canonicalJobId}'`,
      `DELETE FROM jobs.canonical_jobs WHERE id = '${canonicalJobId}'`,
      "SELECT jobs.increment_catalog_search_revision()",
    ]) {
      await expectReaderDenied(statement);
    }
  });
});
