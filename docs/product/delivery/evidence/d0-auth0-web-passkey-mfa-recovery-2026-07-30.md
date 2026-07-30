# D0 Auth0 Web Passkey, MFA, and Recovery Evidence

- Evidence date: 2026-07-30
- Environment: Isolated development tenant and local web client
- Data boundary: Disposable synthetic database user only
- Result: Passed for the web foundation

## Scope

This record covers interactive web passkey enrollment and sign-in, password-plus-TOTP
reauthentication, recovery-code use, administrator-assisted lost-factor recovery, and the
development tenant's post-test prompting policy. It does not cover a production custom domain,
real users, mobile devices, the browser extension, deployed provider outage behavior, or
accountable security/privacy approval.

No email address, tenant identifier, user/provider subject, password, authenticator seed, QR code,
TOTP value, recovery code, passkey credential, cookie, token, authorization code, IP address, or
raw provider log was retained.

## Preconditions

- Public OIDC discovery continued to pass exact issuer, authorization-code, PKCE S256, RS256,
  HTTPS endpoint, and RSA signing-key checks.
- New Universal Login and Identifier First were active.
- One Auth0-hosted database connection permitted password fallback and passkeys.
- Passkey challenge supported both an explicit button and browser autofill; progressive and local
  enrollment were enabled.
- TOTP and recovery-code factors were enabled for the controlled test.

The passkey was intentionally enrolled against the development tenant domain. It is disposable:
activation of the final custom authentication domain requires fresh enrollment.

## Interactive results

| Check | Result |
|---|---|
| Passkey enrollment | The synthetic database user authenticated with its password, completed progressive passkey enrollment, and returned to the local web client. |
| Fresh passkey sign-in | A new private-browser transaction completed with the passkey and returned to the authenticated web client. |
| MFA enrollment | With the temporary tenant policy set to `Always`, the same user enrolled TOTP and received a recovery code. |
| MFA reauthentication | A fresh password transaction required and accepted the TOTP factor before returning to the web client. |
| Administrator-assisted recovery | After the original recovery code was not retained, the product owner reset only the synthetic user's MFA registration, re-enrolled TOTP, and securely retained the newly issued recovery code. |
| Recovery-code sign-in | A fresh password transaction used the recovery-code path instead of the authenticator and returned to the web client. |
| Passkey survival | Resetting MFA registration did not invalidate the database passkey; a fresh passkey transaction still completed. |
| Prompting behavior | The temporary `Always` policy required TOTP after the passkey, demonstrating unnecessary double authentication for the normal passkey path. |
| Restored development policy | The tenant policy returned to `Never` while passkey, TOTP, recovery-code capability, and the user's enrollments remained available. A fresh passkey transaction then completed without TOTP. |

## Policy interpretation

The controlled `Always` interval was a conformance exercise, not the accepted launch policy.
Requiring TOTP after every passkey added a second prompt on top of the phishing-resistant primary
authentication, and this test supplied no risk evidence that justified that friction as the
default. The synthetic-only development tenant therefore retains its non-enforcing policy after
the test.

Before real users are invited, the product must define, implement, test, and receive accountable
review for narrowly scoped reauthentication or step-up behavior for sensitive actions and
elevated-risk sessions. This evidence does not self-approve that future policy.

## Delivery effect

The web passkey, MFA/reauthentication, recovery-code, and lost-factor recovery portion of D0-010
passes. Real extension conformance remains owned by D2, and real mobile recovery/lost-device
conformance remains owned by D6. D0-010 remains in progress for deployed provider/JWKS and
log-delivery outage/recovery evidence.
