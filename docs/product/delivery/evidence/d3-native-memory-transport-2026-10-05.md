# D3-079 native HTTPS material reads — 2026-10-05

## Scope and path

Trusted private launch admission → one existing native candidate/application/generation session →
dedicated TLS 1.3 listener → exact OIDC identity/audience and applications:read scope → private
Applications scalar current-packet proof → owned temporary read/render → source and packet
revalidation → token re-verification → bounded no-store response in the same native process.

Source extends exact PR #555 head `265909a5`, integrated after fetching main `e48bdf3a`.
The backend-only worktree is isolated from frontend work. D3-079 remains In progress.
Existing public preview/file schemas and routes are reused; no Gateway route, frontend,
OpenAPI/domain/event schema, SQL migration or cloud composition changes. The owning proof is a
private in-process capability, not a newly implemented remote RPC. Its authentication/transport
must be supplied before production composition.

## Implemented boundaries

- Documents' private `./native-memory-transport` export supplies a default-off Linux/main-thread
  HTTPS server factory. It never starts listening automatically and exposes only the fixed
  application's preview and PDF/DOCX read paths. It cannot generate or recover a draft, choose
  another owner/generation, access SQL/objects, or acknowledge process/task death.
- The trusted launcher must bind the verified issuer/subject to the fixed internal owner. The
  production verifier uses the existing RS256 OIDC implementation with mandatory expiration.
  Synthetic verifier injection is rejected outside NODE_ENV=test. Token verification is repeated
  after asynchronous authorization/rendering, before serialization and sending.
- The owning Applications helper returns only original scalar reference plus current packet ID
  and hash. It checks application and packet ownership, current packet ID, terminal state,
  artifact hash, exact generation reference, abort and expiry before/after the actual owner read.
  The listener repeats this proof and rejects changed packets. No SQL lock spans rendering.
- Strict method/path/query/host/origin/framing and duplicate-credential checks precede content
  access. Exact approved-origin CORS preflight carries no content or ownership proof. Cookies,
  wildcard origins, caching and body/error logging are absent.
- One active asynchronous read and eight connections bound listener admission; header/TLS/request
  deadlines and a 512 KiB response budget apply. Actual socket disconnect requests cancellation.
  Admission stays occupied until the real pending owner/render call settles, regardless of abort.
  Held content/outgoing buffers clear on response completion, error, cancellation or lease expiry.
  The kernel deadline remains the hard process boundary and is never renewed by HTTP reads.

## Local validation

Targeted source checks pass: Documents and Applications typechecks, thirteen new owning scalar
read tests, four native admission tests, and twelve Auth tests including mandatory-expiration
acceptance/refusal using real signatures and a loopback JWKS server. Final clean-source Linux
and full maintained verification are pending at this start checkpoint.

Expanded Linux verifier compiles the actual kernel module and bundles actual session/SDK,
HTTPS transport, owning scalar helper and signed test-token verifier. The test image is the
existing immutable Linux AMD64 Node 24.21.0/GCC image
`sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
Synthetic self-signed TLS credentials are generated only in bounded test tmpfs. The client verifies
that certificate and hostname; no insecure certificate-verification override is used.
Networking is disabled outside the container; real loopback TCP/TLS remains exercised.

The transport child covers preview, both file formats, unchanged original expiry, signed foreign
identity/unscoped tokens, forged/missing tokens, malformed paths/queries/methods/host/origin/body,
duplicate Authorization headers, TLS downgrade refusal, exact CORS preflight, terminal/changed
packet refusal, owner outage, feature shutdown, pending-read admission and real client disconnect
while authorization is unsettled. The parent observes actual SIGKILL of that same content process
at its lowered original deadline. Model, SQL view, renderer and managed OIDC are synthetic; real
SQL/render evidence from the parent is separate, not a combined native-host test. No live Auth0,
model, ATS, browser or AWS task is exercised by this fixture.

## Remaining gates

Private launch issuer/admission, authenticated remote owner/control adapters, exact allocation
registry, reviewed immutable image, TLS/DNS/task routing and positive managed stop observation
remain unfinished. No public endpoint is enabled. Full browser/content routing, client cleanup,
temporary resume/edit lifecycles, ATS handoff and D3-012 provider no-training/retention approval
remain release gates. Existing Lambda/Gateway content copies are not certified by this native
listener. No all-copy purge, remote provider settlement or candidate-held download deletion is
claimed. Confirmed/ambiguous submission evidence and duplicate guards are unchanged.

D1/D3 exit criteria remain unchecked. Hosted CI/CD remains deferred until production launch.
The proposal in ADR-040 remains unaccepted and does not authorize deployment or a new hostname.
