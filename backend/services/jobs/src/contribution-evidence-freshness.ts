/** Content freshness, not a deployment authorization or an extension of reviewer authority. */
export const CONTRIBUTION_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export const CONTRIBUTION_VERIFICATION_REFRESH_COOLDOWN_MS = 60 * 60_000;
export const CONTRIBUTION_VERIFICATION_REFRESH_MAX_ATTEMPTS = 3;

export function isContributionEvidenceFresh(verifiedAt: string, now: Date): boolean {
  const verified = Date.parse(verifiedAt);
  const current = Date.prototype.getTime.call(now);
  return (
    Number.isFinite(verified) &&
    Number.isFinite(current) &&
    new Date(verified).toISOString() === verifiedAt &&
    current >= verified &&
    current - verified <= CONTRIBUTION_EVIDENCE_MAX_AGE_MS
  );
}
