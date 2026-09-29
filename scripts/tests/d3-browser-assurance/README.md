# D3 local browser assurance

Run `pnpm test:d3-browser-assurance` after installing root development dependencies. The bounded
runner bundles the production Applications workspace, serves it on loopback, and uses generated-
synthetic BFF responses in a locally installed headless Chrome. It exercises the candidate's manual
submission recording action, the existing submitted attestation path, stable idempotency data,
keyboard activation, and automated WCAG rules before and after the state transition.

The runner never downloads a browser, contacts an employer, dispatches a submission, uses a real
identity, or retains candidate data. This is local browser evidence only. It does not establish
managed-OIDC, deployed Gateway/database, provider, legal, privacy, security, human accessibility,
assistive-technology, or real-candidate acceptance.
