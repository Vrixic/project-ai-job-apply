import { createHash } from "node:crypto";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import type { TrustReviewerRole } from "@ai-job-apply/trust-service";

export const trustReviewerRoleScopes: Readonly<Record<TrustReviewerRole, readonly string[]>> =
  Object.freeze({
    case_reader: ["trust:review"],
    case_opener: ["trust:review", "trust:case:open"],
    initial_reviewer: ["trust:review", "trust:case:decide"],
    takedown_reviewer: ["trust:review", "trust:case:takedown"],
    appeal_reviewer: ["trust:review", "trust:appeal:resolve"],
  });

export interface TrustReviewerAssignment {
  issuer: string;
  subject: string;
  roles: readonly TrustReviewerRole[];
}

export class TrustReviewerAccessDeniedError extends Error {
  constructor() {
    super("The Trust reviewer operation is not authorized");
    this.name = "TrustReviewerAccessDeniedError";
  }
}

function assignmentKey(issuer: string, subject: string): string {
  return `${issuer}\0${subject}`;
}

export function trustReviewerId(issuer: string, subject: string): string {
  const bytes = createHash("sha256")
    .update("ai-job-apply/trust-reviewer/v1\0")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class OidcTrustReviewerAuthority {
  private readonly assignments: ReadonlyMap<string, ReadonlySet<TrustReviewerRole>>;

  constructor(assignments: readonly TrustReviewerAssignment[] = []) {
    const normalized = new Map<string, ReadonlySet<TrustReviewerRole>>();
    for (const assignment of assignments) {
      if (
        !assignment.issuer.startsWith("https://") ||
        assignment.subject.length < 1 ||
        assignment.subject.length > 255 ||
        assignment.roles.length < 1
      ) {
        throw new Error("Trust reviewer assignments must be explicit and bounded");
      }
      const key = assignmentKey(assignment.issuer, assignment.subject);
      if (normalized.has(key)) throw new Error("Trust reviewer assignments must be unique");
      normalized.set(key, new Set(assignment.roles));
    }
    this.assignments = normalized;
  }

  resolve(principal: AuthPrincipal, role: TrustReviewerRole): string {
    const requiredScopes = trustReviewerRoleScopes[role];
    const roles = this.assignments.get(assignmentKey(principal.issuer, principal.subject));
    if (!requiredScopes.every((scope) => principal.scopes.includes(scope)) || !roles?.has(role)) {
      throw new TrustReviewerAccessDeniedError();
    }
    return trustReviewerId(principal.issuer, principal.subject);
  }

  requireVerifiedRequesterScope(principal: AuthPrincipal): void {
    if (!principal.scopes.includes("trust:requester:takedown")) {
      throw new TrustReviewerAccessDeniedError();
    }
  }
}
