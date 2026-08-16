# OpenAPI Sources

Versioned REST API source documents. These files are reviewed before implementation changes and
drive generated transport types and clients.

The saved-job paths separate `jobs:read` list access from `jobs:write` mutation access, never accept
an owner identifier, and return only bounded public snapshots plus `available` or `unavailable`.
The unavailable state intentionally carries no internal lifecycle reason. Saved-job responses,
including idempotent deletion, are private and declare `Cache-Control: no-store`.
