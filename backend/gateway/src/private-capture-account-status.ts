import type { PrivateCaptureAccountStatus } from "@ai-job-apply/matching-service";
import type postgres from "postgres";

/**
 * Profile-owned account authority for Matching's private-capture command boundary.
 * Database failures propagate so the Matching service fails unavailable; absence and
 * quarantine both deny the command.
 */
export class PostgresProfilePrivateCaptureAccountStatus implements PrivateCaptureAccountStatus {
  constructor(private readonly client: postgres.Sql) {}

  async isActive(ownerUserId: string): Promise<boolean> {
    const rows = await this.client<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM identity.users
        WHERE id = ${ownerUserId}::uuid
          AND account_state = 'active'
      ) AS active
    `;
    return rows[0]?.active === true;
  }
}
