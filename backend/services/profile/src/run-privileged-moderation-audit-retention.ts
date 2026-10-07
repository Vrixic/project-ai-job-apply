import postgres from "postgres";
import { PostgresPrivilegedModerationAuditStore } from "./privileged-moderation-audit.js";

const enabled = () => process.env.PRIVILEGED_MODERATION_AUDIT_RETENTION_ENABLED === "true";
if (!enabled()) throw Error("PrivilegedModerationAuditRetentionDisabled");
const url = process.env.DATABASE_URL;
if (!url) throw Error("PrivilegedModerationAuditRetentionUnavailable");
const batch = process.env.PRIVILEGED_MODERATION_AUDIT_RETENTION_BATCH_LIMIT ?? "100";
if (!/^[1-9][0-9]{0,3}$/u.test(batch) || Number(batch) > 1_000)
  throw Error("PrivilegedModerationAuditRetentionUnavailable");
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  const expired = await new PostgresPrivilegedModerationAuditStore(sql, enabled).expire(
    Number(batch),
  );
  console.log(JSON.stringify({ owner: "profile", privilegedModerationAuditExpired: expired }));
} catch {
  throw Error("PrivilegedModerationAuditRetentionUnavailable");
} finally {
  await sql.end();
}
