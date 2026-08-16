import { describe, expect, it } from "vitest";
import { resolveRestoreDatabaseUrl, restoreConnectionOptions } from "./restore-verifier-runtime.js";

describe("restore verifier database boundary", () => {
  it("bounds connection and idle waits for the one-off verifier", () => {
    expect(restoreConnectionOptions).toEqual({ connect_timeout: 15, idle_timeout: 30, max: 1 });
    expect(Object.isFrozen(restoreConnectionOptions)).toBe(true);
  });
  it("replaces only the hostname with an exact RDS restore endpoint", () => {
    expect(
      resolveRestoreDatabaseUrl({
        DATABASE_URL:
          "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require",
        RESTORE_HOST: "restore.abc123.us-east-2.rds.amazonaws.com",
      }),
    ).toBe(
      "postgres://platform:secret@restore.abc123.us-east-2.rds.amazonaws.com:5432/ai_job_apply?sslmode=require",
    );
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "restore.rds.amazonaws.com.evil.example",
    "restore:5432.us-east-2.rds.amazonaws.com",
    "Restore.us-east-2.rds.amazonaws.com",
    `${"a".repeat(240)}.rds.amazonaws.com`,
  ])("rejects an invalid restore hostname: %s", (restoreHost) => {
    expect(() =>
      resolveRestoreDatabaseUrl({
        DATABASE_URL:
          "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require",
        RESTORE_HOST: restoreHost,
      }),
    ).toThrow("RESTORE_HOST is not an exact RDS hostname");
  });

  it.each([
    "postgres://platform:secret@source.internal:5432/ai_job_apply",
    "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=disable",
    "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=prefer",
    "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require&sslmode=require",
    "https://platform:secret@source.internal:5432/ai_job_apply?sslmode=require",
    "postgresql://platform:secret@source.internal:5432/ai_job_apply?sslmode=require",
    "postgres://other:secret@source.internal:5432/ai_job_apply?sslmode=require",
    "postgres://platform@source.internal:5432/ai_job_apply?sslmode=require",
    "postgres://platform:secret@source.internal/ai_job_apply?sslmode=require",
    "postgres://platform:secret@source.internal:5432/other?sslmode=require",
    "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require&application_name=restore",
    "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require#fragment",
  ])("rejects a database URL outside the exact TLS boundary: %s", (databaseUrl) => {
    expect(() =>
      resolveRestoreDatabaseUrl({
        DATABASE_URL: databaseUrl,
        RESTORE_HOST: "restore.abc123.us-east-2.rds.amazonaws.com",
      }),
    ).toThrow("DATABASE_URL must use the exact required PostgreSQL TLS boundary");
  });

  it("requires an explicit reviewed RDS host even when the secret contains a host", () => {
    expect(() =>
      resolveRestoreDatabaseUrl({
        DATABASE_URL:
          "postgres://platform:secret@source.internal:5432/ai_job_apply?sslmode=require",
      }),
    ).toThrow("RESTORE_HOST is not an exact RDS hostname");
  });
});
