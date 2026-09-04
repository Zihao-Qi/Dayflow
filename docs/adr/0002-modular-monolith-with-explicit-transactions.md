---
status: accepted
date: 2026-09-04
---

# Structure Dayflow as a modular monolith with explicit transactions

Dayflow's rules are sound and its tests are real, but its boundaries are
conventions written in filenames. `src/lib` is a flat set of files whose
suffixes imply layers that nothing enforces. Route handlers own transactions.
Seven functions default or fall back to the global Prisma client and one
service calls it with no parameter at all, so a caller that forgets to forward
a transaction gets a write outside it with no type error. Error envelopes differ by boundary and one helper derives an HTTP status
by parsing an error message. The dashboard component owns app-wide state and
three destinations at once.

The chosen two-machine path is one authoritative SQLite host over Tailscale,
which needs no tenancy, no cloud storage and no database change. This decision
adds only the seams that pay for themselves for one developer on that path.

## Decision

Dayflow is one Next.js process organised as seven domain modules under
`src/modules`, each with three parts, plus a small `src/server` folder for
work that crosses modules.

- Modules: `planning`, `projects`, `focus`, `evidence`, `journal`, `review`,
  `data-ops`. They follow the language in `CONTEXT.md`, not the six screens.
- Parts: `domain/` is pure and isomorphic and imports only `src/shared/kernel`;
  `services/` talks to Prisma and is the headless seam tests call without HTTP;
  `ui/` is React and never imports `services/`.
- Imports between modules are direct calls allowed only along this graph:
  planning → projects; focus → planning, projects, evidence; evidence →
  planning, projects; journal → planning, projects; review → planning,
  evidence, journal, projects; projects and data-ops import no module; nothing
  imports review.
- Project completion, project deletion and phase deletion are
  `src/server/workflows`. Bootstrap, project detail, agent export and CSV
  export are `src/server/read-models` and run in read transactions.
- Mutation services take a non-optional `Prisma.TransactionClient` first. No
  parameter defaults to or falls back on the global client, and no service
  uses the global client as a call receiver. Services never import the global
  client module, a one-hop re-export of its binding, or `@prisma/client` as a
  value, and never call `$transaction`. `import type` from `@prisma/client` is
  allowed so the transaction parameter can be named. Only route handlers,
  workflows, read models and the idempotency helper open transactions. The
  focus-start serializer stays in front of the idempotency helper; it handles
  SQLite writer contention, not transaction composition.
- One exported function in `evidence` is the only creator of
  `origin: FOCUS` Activities. Focus completion and enrichment call it with
  the same transaction. `ActivityEntry.focusSessionId` stays unique. The
  architecture test constrains where Activity writes can occur; behavior
  tests prove what they write.
- One `AppError` type with per-boundary catalogs that state the exact status,
  message and which of `code` and `field` each envelope carries today,
  including 403 and 415 on backups and the journal `{code, error}` shape. One
  serializer. Contract tests compare parsed JSON, so key order is not a
  promise. Prisma error translation stays operation-local.
- Clock and Calendar are injected at construction. `LocalDay` is a branded
  string at the domain and HTTP boundary only; persistence keeps `Date`.
- One client request helper, one mutation-id hook, one decoder per DTO.
  Bootstrap refresh with a generation guard remains the invalidation model;
  destinations move to coarse reads in the `/api/day` pattern.
- Shared code lives in `src/shared/kernel` (pure, isomorphic),
  `src/shared/client` (browser only) and `src/shared/ui` (design primitives).
- The backup engine moves from `scripts/` into `data-ops`; argument parsing
  stays in `scripts/`. Prisma access becomes a lazy getter, not a proxy,
  converted at every call site, so startup restore always precedes the first
  open.
- One repository test, `tests/architecture.test.ts`, enforces the graph, the
  transaction rules and the Activity write allowlist. It runs first in
  `npm run check`, carries an explicit baseline of known violations that only
  shrinks, and `ARCHITECTURE_STRICT=1` ignores the baseline. The rules, the
  baseline and the initial allowlist are specified in
  `docs/specs/ARCHITECTURE_MIGRATION_V1.md`.

## Considered Options

- Keep the flat `src/lib` and rely on review. Rejected: the transaction
  escape paths and the route-owned transactions are review failures that
  already happened.
- Hexagonal modules with consumer-owned ports, a composition layer and a
  generic unit of work. Rejected after review: in one process on one SQLite
  file, direct calls with an explicit transaction preserve atomicity; ports
  add indirection, not a guarantee, and five layers per module is the
  ceremony this decision exists to avoid.
- Split into services. Rejected: it would destroy the atomic
  focus-to-activity guarantee and the verified backup path.
- Adopt a client query cache with a granular invalidation map. Deferred: at
  loopback latency with one user, bootstrap refresh plus coarse reads is the
  honest model, and a partial invalidation map would stale Review and Log
  first.

## Consequences

- Transactions are visible in every mutation signature. Forgetting to
  forward one is a type error. The seven parameter defaults are the first
  migration PR; the sixteen calls through the global client leave with their
  files as each service moves.
- Use cases become testable on a temporary SQLite without a `NextRequest`.
- The focus invariant is enforced by one function plus an allowlist, not by
  convention.
- Cross-module reads and cycle-breaking workflows have one home, so
  `projects` never reaches back into `planning`.
- Error envelopes are specified per boundary and pinned by contract tests,
  so they cannot drift silently. The architecture test does not check HTTP
  shapes; the contract tests do.
- The dashboard shrinks to a shell as destinations move into module `ui`
  folders, in parallel with the server work.
- Hosting seams, a workspace column with its composite uniqueness changes,
  per-workspace timezone and a Postgres provider, are bounded changes to
  services and startup if a host is ever chosen. D1 is excluded because its
  Prisma adapter has no transactions.
- The phased plan, its guardrails and its acceptance criteria are in
  `docs/specs/ARCHITECTURE_MIGRATION_V1.md`.
