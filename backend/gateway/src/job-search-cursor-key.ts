import { hkdfSync } from "node:crypto";
import type { JobSearchCursorKeyring, ModerationCursorKey } from "@ai-job-apply/jobs-service";

const CURSOR_KEY_SALT = Buffer.from("ai-job-apply/job-search-cursor/salt/v1", "utf8");
const CURSOR_KEY_INFO = Buffer.from("gateway/catalog-search-continuation/v1", "utf8");
const MODERATION_CURSOR_KEY_INFO = Buffer.from("gateway/moderation-case-continuation/v1", "utf8");

export function deriveJobSearchCursorKeys(databaseUrl: string): JobSearchCursorKeyring {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The job-search cursor key requires a PostgreSQL database URL");
  }
  return {
    active: {
      id: "db-url-v1",
      key: Buffer.from(
        hkdfSync("sha256", Buffer.from(databaseUrl, "utf8"), CURSOR_KEY_SALT, CURSOR_KEY_INFO, 32),
      ),
    },
  };
}

export function deriveModerationCursorKey(databaseUrl: string): ModerationCursorKey {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The moderation cursor key requires a PostgreSQL database URL");
  }
  return {
    id: "db-url-v1",
    key: Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(databaseUrl, "utf8"),
        CURSOR_KEY_SALT,
        MODERATION_CURSOR_KEY_INFO,
        32,
      ),
    ),
  };
}
