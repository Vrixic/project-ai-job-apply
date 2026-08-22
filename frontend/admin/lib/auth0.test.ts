import { describe, expect, it } from "vitest";
import {
  adminAbsoluteSessionSeconds,
  adminMfaAcr,
  adminReauthenticationSeconds,
  requireAdminMfa,
  requestedAuthScopes,
} from "./auth0.js";

describe("admin Auth0 policy constants", () => {
  it("freezes the least-privilege short-session MFA candidate", () => {
    expect(requestedAuthScopes).toBe("openid profile jobs:moderate");
    expect(requestedAuthScopes).not.toContain("offline_access");
    expect(adminMfaAcr).toBe("http://schemas.openid.net/pape/policies/2007/06/multi-factor");
    expect(adminReauthenticationSeconds).toBe(900);
    expect(adminAbsoluteSessionSeconds).toBe(3_600);
  });

  it("fails closed unless the identity-provider session proves MFA", () => {
    expect(() => requireAdminMfa({ user: {} })).toThrow("did not prove MFA");
    expect(() => requireAdminMfa({ user: { amr: ["pwd"] } })).toThrow("did not prove MFA");
    const session = { user: { amr: ["pwd", "mfa"] } };
    expect(requireAdminMfa(session)).toBe(session);
  });
});
