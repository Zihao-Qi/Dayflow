# Architecture Migration v1

Status: Proposed
Date: September 4, 2026
Scope: Structural migration implementing `docs/adr/0002-modular-monolith-with-explicit-transactions.md`

## Purpose

Dayflow's rules are correct and tested, but its boundaries are conventions.
This specification defines how the code moves from the flat `src/lib` and the
route-owned transactions to the modular monolith in ADR 0002 without changing
any externally observable behavior, what proves that at every step, and the
rules the architecture test enforces.

## Goals

- Every mutation's transaction is visible in its signature, and
  `$transaction` is opened only under `src/app/api`, `src/server` and the
  idempotency helper.
- Every use case is callable in a test without an HTTP request.
- Every error envelope is specified per boundary and pinned by a contract
  test before the code that emits it moves.
- The dashboard becomes a shell while destinations move into module
  folders, in parallel with the server work.
- One repository test enforces the module graph, the transaction rules and
  the Activity write allowlist, runs immediately after `prisma:generate` in
  `npm run check`, and only ratchets down.

## Non-Goals

- Any change to an error envelope, including unifying the journal and
  activity shapes. That is a product change with its own specification.
- Compare-and-update concurrency on writes that lack it today.
- Typed receipt replay.
- A client query cache or granular invalidation map.
- Hosting and deployment topology. A workspace column with its composite
  uniqueness changes, per-workspace timezone and a Postgres provider are
  recorded in ADR 0002 as bounded changes if a host is ever chosen; that is
  a separate decision.
- Rewriting the backup engine. It moves; it does not change.

## Migration Principles

1. **Behavior is frozen; test files are not.** A replacement test must fail
   on the same seeded conflict before the implementation-coupled test it
   replaces is deleted.
2. **Characterize before moving.** No file moves until the envelopes and
   workflows it participates in have a test that fails on drift.
3. **The architecture test only ratchets down.** It carries an explicit
   baseline of known violations, each annotated with the phase that removes
   it. Anything outside the baseline fails the build. A baseline entry that
   no longer matches a violation also fails, so the list cannot go stale.
4. **The active database is touched last.** The backup engine and lazy Prisma
   access move after the service pattern is proven, as separate PRs gated by
   the startup-restore integration test.
5. **Riskiest server step last.** Focus completion, the one transaction that
   holds the focus-to-activity invariant, is the final service to move.
6. **Two tracks.** Client extraction needs no server change and starts on
   day one.

## The Architecture Test

`tests/architecture.test.ts` runs as `npm run test:architecture`, immediately
after `prisma:generate` as the first validation gate in `check`, in under
five seconds, with no new dependency. It parses the tree with the TypeScript
compiler API and enforces the rules below on static, string-literal module
references and direct call expressions. Dynamically constructed import paths,
aliased model delegates and SQL assembled across strings are outside its
reach; behavior tests cover those. Each rule is proven inside the test by a
synthetic fixture with one passing and one failing case, because several
rules target directories that do not exist until the migration creates them.

1. **Module graph.** Imports between `src/modules/<a>` and `src/modules/<b>`
   are allowed only along: planning → projects; focus → planning, projects,
   evidence; evidence → planning, projects; journal → planning, projects;
   review → planning, evidence, journal, projects. Projects and data-ops
   import no module. Nothing imports review. `src/server` may import any
   module. Imports from `src/app` that resolve under `src/modules` may
   target only a module's `domain` or `ui`; imports from `src/app` into
   legacy `src/lib` and `src/components` are outside the rule until those
   directories are deleted.
2. **Domain purity.** Every reference from `src/modules/<m>/domain` must
   resolve to `src/shared/kernel` or to the same module's `domain` folder,
   by relative or `@/` path. Every bare package reference, including Prisma,
   Next, React and `node:*`, is rejected.
3. **UI isolation.** References from `src/modules/*/ui` are rejected when
   they resolve to any `src/modules/*/services` folder or to `src/server`,
   or when the specifier is `@prisma/client` or one of its subpaths,
   type-only imports included.
4. **Services never hold the client.** Under `src/modules/*/services`:
   value imports from `@prisma/client` or its subpaths are rejected, while
   type-only imports are allowed so a service can name
   `Prisma.TransactionClient`; imports of the global client module, of a
   module that constructs `new PrismaClient`, or of a file that re-exports
   the client binding from one of those (one hop, not transitive) are
   rejected; imports resolving to `src/server` are rejected; any call to a
   property named `$transaction` is rejected. In services, and in legacy
   `src/lib` until it is deleted, a call rooted at an imported global-client
   binding is a violation. The global client module itself and
   `src/lib/idempotent-mutations.ts`, a transaction root, are excluded.
   Independently, constructing a Prisma client anywhere under `src/`
   outside the explicit canonical modules `src/lib/prisma` and
   `src/server/prisma/client` is a violation, whether or not the file
   makes a global-client call. Construction recognition is syntactic:
   `new PrismaClient(...)` or a `new` expression whose constructor is a
   property access named `PrismaClient`; constructor aliases are not resolved.
5. **No fallback to the global client.** In any file under `src/` that
   imports the global-client binding, by its own name or an alias, a
   parameter initializer containing that binding, or a `??`, `||`, `??=`
   or `||=` fallback to it, is rejected.
6. **Transaction roots.** A direct call to a property named `$transaction`
   is permitted only under `src/app/api`, `src/server`, and the idempotency
   helper: today `src/lib/idempotent-mutations.ts`, later
   `src/server/prisma/run-once.ts`.
7. **Activity writes.** Every direct call whose receiver property or
   identifier is `activityEntry` and whose method is `create`, `createMany`,
   `upsert`, `update`, `updateMany`, `delete` or `deleteMany` under `src/`,
   and every string or template literal containing `INSERT INTO`,
   `INSERT OR REPLACE INTO`,
   `INSERT OR IGNORE INTO`, `UPDATE` or `DELETE FROM` against `ActivityEntry`,
   must be in the test's allowlist, and the allowlist must contain nothing
   else. Deletions count as writes; the initial allowlist names six call
   sites. Recognition is syntactic, by receiver and method names (including
   string-literal element access) or SQL text, without type resolution. The
   allowlist constrains where writes can happen; it does not inspect
   payloads. Behavior tests prove that only the evidence focus writer
   persists `origin: FOCUS`. `prisma/seed.ts` and `scripts/` are outside
   the rule.
8. **Scripts direction.** `scripts/` may reference `src/`; every reference
   under `src/` that resolves to `scripts/` is rejected.

### Initial baseline

On the tree this specification was written against, the test reports and
tolerates exactly 36 known violations. Each carries the phase that removes
it. A baseline entry that no longer matches a violation fails the test, so
the list cannot go stale, and a legacy file whose call count changes in
either direction fails until its entry is corrected in the same change.

- Rule 5, seven sites, removed in phase 1: parameters defaulting or
  falling back to the global client in `focus-queue.ts` (1), `projects.ts`
  (2), `csv-export.ts` (1), `focus-sessions.ts` (2) and
  `evidence-attribution.ts` (1).
- Rule 4, sixteen calls through the global client with no parameter,
  tracked by exact per-file count and removed when that file's service
  moves: `activity-persistence.ts` (1, phase 3 evidence),
  `focus-queue.ts` (3, phase 2), `focus-sessions.ts` (7, phase 3 focus),
  `projects.ts` (3, phase 3 projects; `listProjectSummaries` is among
  them), `time-block-persistence.ts` (2, phase 2).
- Rule 6, twelve `$transaction` calls, removed when that file's service
  moves: `focus-queue.ts` (3) and `time-block-persistence.ts` (1) in
  phase 2; `activity-persistence.ts` (1), `focus-sessions.ts` (3),
  `journal-history.ts` (1), `projects.ts` (2) and
  `workspace-readiness.ts` (1) in phase 3.
- Rule 8, one site, removed in phase 4: the import from
  `backup-management.ts` into `scripts/database-backup.ts`.

### Initial Activity write allowlist

Exactly six keys: `src/app/api/activities/[id]/route.ts:60:activityEntry.deleteMany`,
`src/app/api/activities/route.ts:34:activityEntry.create`,
`src/lib/activity-persistence.ts:84:activityEntry.updateMany`,
`src/lib/focus-sessions.ts:280:activityEntry.upsert`,
`src/lib/focus-sessions.ts:387:activityEntry.upsert` and
`src/lib/projects.ts:162:activityEntry.updateMany`. When a call moves, its
key is replaced with the relocated key in the same change. After phase 3
the two focus keys point at the single creator function in `evidence`.

`ARCHITECTURE_STRICT=1` ignores the baseline and exits non-zero while any
violation remains.

## Phase 0: Characterize and Guard

- Inventory every reachable non-2xx envelope per route and method: the
  triggering input, exact status, exact JSON keys and values, and the
  contract test that pins it. Phase 0 is incomplete while any route error
  branch lacks a row, including 403 and 415 on backups, the journal
  `{code, error}` shape, and the activity-delete 404 without `code`.
- For task update, focus start including its serializer, focus complete and
  enrich, project completion and deletion, activity replace and delete, and
  receipt replay: add an integration test that seeds the named conflict,
  calls the current public seam, and asserts both the returned contract and
  the committed or rolled-back database state.
- Add the architecture test with the exact baseline and allowlist above, and
  run `test:architecture` immediately after `prisma:generate` in `check`.
- Replace whole-payload snapshots of bootstrap and agent export with
  explicit assertions on the current top-level key set and the named
  invariants: no future evidence, unfinished tasks keep their date, tags
  decode to arrays.

Exit: every current envelope and workflow has a test that fails on drift; the
architecture test reports the baseline and passes.

## Phase 1: Kernel and Spine

1. Make the transaction parameter required on the seven rule 5 sites and
   forward it from every caller. Behavior-preserving; empties the rule 5
   baseline. The sixteen rule 4 call-through sites, `listProjectSummaries`
   among them, leave with their files in phases 2 and 3.
2. Extract `src/shared/kernel/parsing.ts` from the six copies of
   `requireObject`, `parseBoundedInteger` and the body readers. Messages stay
   identical; each `*-mutations.ts` becomes a thin wrapper.
3. Introduce `AppError`, the per-boundary catalogs and the single serializer.
   Routes switch one at a time; the phase 0 contract tests prove equality.
   Delete `taskProjectRuleErrorDetails` once placement throws catalog
   entries.
4. Inject Clock and Calendar into the modules that need time. The `TZ` pin
   stays on integration and e2e scripts; only pure unit tests use a frozen
   clock.
5. Run bootstrap and agent export inside one read transaction. No envelope
   change.

Exit: rule 5 baseline empty; one serializer; no Prisma error code
interpreted outside the service that knows its meaning.

## Phase 2: Prove the Service Pattern on Planning

1. Time block create as the proof: the smallest complete slice, with the
   idempotency helper `runOnce` and a headless integration test.
2. Tasks in one PR: create, update, delete, reorder and schedule undo become
   services; the inline route transactions go; placement is imported from
   projects along the graph.

Exit: routes under `app/api/tasks/**` and `time-blocks/**` only parse, open
the transaction, call a service and serialize; contract tests unchanged and
green; every planning service has an integration test that calls it without
HTTP; the planning entries leave the baseline.

## Phase 3: Remaining Services in Graph Order

1. Projects: placement and metrics stay in the module; completion, deletion
   and phase deletion become `server/workflows`; summaries and detail become
   `server/read-models`. CSV export becomes a read model here too, which
   removes the remaining Rule 5 baseline entry.
2. Evidence: activity create, replace and delete share one protection rule;
   attribution becomes a domain function; `focus-activity.ts` is created and
   becomes the only allowlisted writer of `origin: FOCUS`.
3. Journal, then review: reads with cursor pagination become services.
4. Focus, last: the pure state machine, then start, transition and enrich
   services calling evidence and planning with the same transaction. The
   start serializer stays. Five tests gate the merge: rollback when evidence
   fails, concurrent completion, receipt replay, zero-minute focus, Break
   completion.

Exit: `src/lib` is empty and deleted; only routes, workflows, read models and
`runOnce` open transactions; the Activity write allowlist contains only the
sites this specification names, with the focus entries moved to the single
creator.

## Client Track, in Parallel from Day One

1. One request helper and one mutation-id hook replace every raw `fetch` and
   hand-written response guard. Same behavior.
2. Extract pages in this order: Journal, Backlog with the matrix, Today with
   the task row, first-run, then the dialogs. Each moves to a module `ui`
   folder and receives data through a hook.
3. Split the data-management dialog by concern and the focus timer into rail,
   ring and completion form.
4. Move Today and Review to their own coarse reads in the `/api/day` pattern.
   Bootstrap refresh with a generation guard remains the invalidation model.
5. `dashboard.tsx` becomes `src/shell`, owning navigation, the capture
   palette, the focus rail and first-run only.

Exit: no destination or dialog lives in the shell; no raw `fetch` outside
`shared/client`; e2e suite unchanged and green.

## Phase 4: Backup Engine and Lazy Prisma

1. Move `scripts/database-backup.ts` and `database-migration.ts` into
   `modules/data-ops/services`; scripts keep argument parsing and import from
   there. Zero logic change. Removes the rule 8 baseline entry.
2. Replace the module-evaluation Prisma singleton with a lazy getter and
   convert every call site. No proxy.
3. Split `backup-management.ts` into policy and retention, restore
   coordinator, automatic runner.

Each step is its own PR and the startup-restore integration test is the gate.

Exit: architecture baseline empty in strict mode; startup restore still
precedes the first Prisma open.

## Required Test Coverage

| Layer | Test | Added in |
| --- | --- | --- |
| domain | node:test on pure functions with a frozen clock | as modules land |
| services, workflows | temporary SQLite, called without HTTP; seeded concurrency and rollback cases | phase 0 |
| app/api | route handler contract tests; expectation changes need contract review | phase 0 |
| read models, exports | invariant assertions, no whole-payload snapshots | phase 0 |
| boundaries | `tests/architecture.test.ts`: the eight rules, baseline, allowlist | phase 0 |
| whole product | Playwright on a disposable database | existing |

## Acceptance Criteria

- `npm run check` is green at the end of every PR.
- No contract test expectation changes without a product specification.
- The architecture baseline never grows, never goes stale, and is empty in
  strict mode after phase 4.
- Every service has at least one integration test that does not construct a
  `NextRequest`.
- The startup-restore integration test passes after each phase 4 PR.
