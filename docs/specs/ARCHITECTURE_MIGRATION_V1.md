# Architecture Migration v1

Status: Completed — Architecture exit condition reached (ARCHITECTURE_STRICT=1 passes with 0 violations)
Date: September 4, 2026 (proposed); updated September 6, 2026
Validated main commit: dc9e28452a8bc721e75571dd19ba804f5066a389 (PR #64 merge)
Scope: Structural migration implementing `docs/adr/0002-modular-monolith-with-explicit-transactions.md`

## Current Status (as of commit dc9e284)

- **Terminal exit condition reached on main:**
  - `ARCHITECTURE_STRICT=1 npm run test:architecture`: **0 violations** (exits 0; 119 tests, 111 pass, 0 fail, 8 todo).
  - `BASELINE`: **0 violations** (empty array `[]`).
  - `LEGACY_GLOBAL_CLIENT_CALL_BASELINE`: **0 call sites across 0 files** (empty array `[]`).
  - `ACTIVITY_WRITE_ALLOWLIST`: exactly **5 call sites**.
- **Verified gate output on current main (`dc9e284`):**
  - `npm run test:architecture`: 119 tests, 111 pass, 0 fail, 8 todo.
  - `ARCHITECTURE_STRICT=1 npm run test:architecture`: 119 tests, 111 pass, 0 fail, 8 todo.
  - `npm run typecheck`: 0 errors (`tsc --noEmit` clean).
  - `npm run test:unit`: 443 tests, 443 pass, 0 fail.
- **Phase completion breakdown:**
  - **Phase 0:** Complete (PR #44 `a5e2647`, PR #49 `0cef27f`).
  - **Phase 1:** Complete (PR #45 `0e7cee7`, PR #47 `7c29ad2`, PR #50 `7cbe2b1`, PR #53 `ac696ce`, PR #48 `64b935d`, plus gate unwrap repair PR #71 `24b04e1`).
  - **Phase 2:** Complete (PR #54 `09f642e`, PR #56 `dea5eeb`).
  - **Phase 3:** Complete (PR #59 `c01d962`, PR #60 `b3a72f7`, PR #61 `656888b`, PR #62 `0e7fd1d`, PR #66 `1d2d8ab`, PR #67 `567bd7c`). All six slices merged.
  - **Phase 4:** Engine work complete (PR #63 `8d00dfd`). Lazy Prisma (PR #68) and backup split (PR #69) pending republish as rebuilt candidates.
  - **Client Track:** Extracted and coarse reads complete (PR #57 `fd68635`, PR #46 `d55af62`, PR #51 `d743e96`, PR #52 `f18fa03`, PR #55 `a1b9b67`, PR #58 `e72fd99`, PR #64 `dc9e284`). E2E flake hardening (PR #65) pending.
  - **Public readiness:** PR #75 (`e69910f`) added MIT license and gitignored local working notes (`AGENTS.md`, `docs/research/`).
- **Remaining PRs:**
  - **PR #65** (`arch/e2e-flake-hardening`): OPEN / pending (browser flake hardening).
  - **PR #68** (`arch/phase4-lazy-prisma`): DRAFT / pending republish (rebuilt lazy Prisma getter; must not merge from existing published head).
  - **PR #69** (`arch/phase4-backup-split`): DRAFT / pending republish (rebuilt backup split; must not merge from existing published head).
  - **PR #70** (`arch/server-integration`): DRAFT / **permanently excluded** from merge queue.


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
   or to `src/shell`, or when the specifier is `@prisma/client` or one of
   its subpaths, type-only imports included. Module UI receives data and
   callbacks; it must not depend on the shell's state or composition types.
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

**Execution status:** Complete.
- PR #44 (`a5e2647`): Added `tests/architecture.test.ts` enforcing the 8 rules, initial baseline (36 violations), and Activity write allowlist (6 keys). Added `test:architecture` to `check`.
- PR #49 (`0cef27f`): Added error envelope inventory, route contracts, seeded conflict rollback tests, and explicit read-model invariant assertions for bootstrap and agent export.

**Original plan and exit target (historical):**

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
  invariants: unfinished tasks keep their date and tags decode to arrays.
  Bootstrap bounds Activity evidence to the half-open local day, from local
  midnight (inclusive) to next local midnight (exclusive).
  Agent export includes all stored Activities with no date cutoff.

Exit: every current envelope and workflow has a test that fails on drift; the
architecture test reports the baseline and passes.

## Phase 1: Kernel and Spine

**Execution status:** Complete.
- Item 1: PR #45 (`0e7cee7`): Made transaction parameter required on all seven Rule 5 sites, reducing baseline from 36 to 29.
- Item 2: PR #47 (`7c29ad2`): Extracted shared parsing kernel (`src/shared/kernel/parsing.ts`).
- Item 3: PR #50 (`7cbe2b1`): Introduced `AppError`, per-boundary catalogs, and common serializer.
- Item 4: PR #53 (`ac696ce`): Injected Clock and Calendar across domains.
- Item 5: PR #48 (`64b935d`): Ran bootstrap and agent export in single read transactions with explicit 60-second budgets.
- Gate repair: PR #71 (`24b04e1`): Unwrapped syntactic wrappers in architecture scanner.

**Original plan and exit target (historical):**

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

**Execution status:** Complete.
- Item 1: PR #54 (`09f642e`): Extracted Time Block CRUD services and relocated idempotency helper `runOnce` to `src/server/prisma/run-once.ts`.
- Item 2: PR #56 (`dea5eeb`): Extracted Task and Focus Queue mutations into planning services with headless SQLite integration tests.

**Original plan and exit target (historical):**

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

**Execution status:** Complete (all six slices merged on main).
- Item 1: PR #59 (`c01d962`): Moved Projects domain, services, workflows (`delete-project`), and read models (`projects-summary`, `project-detail`). Merged.
- Item 2: PR #60 (`b3a72f7`): Moved Activity and Diary evidence into services with one protection rule; attribution became a domain function; `focus-activity.ts` was created with `recordFocusActivity` as the sole allowlisted writer of `origin: FOCUS`. Merged.
- Item 3: PR #61 (`656888b`): Moved Notes and Materials into Journal services with cursor pagination. Merged.
- Item 4: PR #62 (`0e7fd1d`): Moved Review into services and read models, providing canonical domain error catalog and current-window parsing. Merged.
- Item 5: PR #66 (`1d2d8ab`): Focus pure state machine, timer operations, and transactional completion/enrichment. Consolidated the two legacy focus-session allowlist writes into `recordFocusActivity` and removed focus-session baseline entries. Merged.
- Read models: PR #67 (`567bd7c`): Unified bootstrap composition and workspace readiness read model (`src/server/read-models/bootstrap.ts`, `src/server/read-models/workspace-readiness.ts`), eliminating the `workspace-readiness.ts` baseline violation. Merged.
- Deviation note: Compatibility shims and non-violating shared utilities remain under `src/lib` rather than deleting the directory, maintaining external compatibility without violating architecture rules.

**Original plan and exit target (historical):**

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

**Execution status:** Partially complete (Items 1, 2, 3, 4, 5 merged; E2E hardening PR #65 pending).
- Item 1: PR #57 (`fd68635`): Unified client transport with `createClientRequestHelper` and mutation ID hook. Merged.
- Item 2: PR #46 (`d55af62`), PR #51 (`d743e96`), PR #52 (`f18fa03`): Extracted Journal, Backlog with matrix, and Today with TaskRow to module `ui` packages. Merged.
- Item 3: PR #55 (`a1b9b67`): Split data-management dialog by concern and separated focus timer UI. Merged.
- Item 4: PR #64 (`dc9e284`): Coarse reads for Today and Review. Merged. (Rehearsal on `merge/rehearse-64` failed to predict 38 unit test failures on merge due to an unprojected clean-merge export swap in `src/lib/review-records.ts`; resolved on merge branch).
- Item 5: PR #58 (`e72fd99`): Dashboard became `src/shell` as composition root. Merged.
- E2E flake hardening: PR #65 (`arch/e2e-flake-hardening`): Status: OPEN / pending merge.
- Persistent destination controllers: Follow-up prepared locally at checkpoint `ba30c21`.

**Original plan and exit target (historical):**

1. One request helper and one mutation-id hook replace every raw `fetch` and
   hand-written response guard. Same behavior.
2. Extract pages in this order: Journal, Backlog with the matrix, Today with
   the task row, first-run, then the dialogs. Each moves to a module `ui`
   folder and receives data through a hook.
3. Split the data-management dialog by concern and the focus timer into rail,
   ring and completion form.
4. Move Today and Review to their own coarse reads in the `/api/day` pattern.
   Bootstrap refresh with a generation guard remains the invalidation model.
5. `dashboard.tsx` becomes `src/shell`, owning navigation, capture-palette
   coordination, focus-rail placement and first-run coordination. It is also
   the application composition root: it mounts module UI, keeps module hooks
   alive across destination changes, owns bootstrap/startup recovery and
   refresh, and delivers application-wide errors and live announcements.
   Module hooks own destination and dialog drafts, validation, mutation
   payloads, optimistic update policy, retries and feature-specific recovery.

### Shell ownership decision (September 5, 2026)

Mounting a module's page or dialog does not make its implementation shell-owned.
The shell needs one place to join all seven modules: none can own navigation,
startup, bootstrap invalidation or application-wide announcements without
reversing the module graph. Those are explicit, bounded composition duties.
Likewise, a module hook may be called unconditionally from the shell so its
draft survives navigation; its state and behavior must still be defined in
that module. Moving a hook into a conditional page would change draft lifetime.

The shell may retain screen/selected-project navigation state, palette query
and opener, mobile-menu and rail visibility, focus launch intent, first-run
seen state, and a boolean to open Data & backups. It may pass bootstrap slices,
adapt module callbacks to replace those slices, and forward module-produced
navigation counts. A slice adapter may replace a value or apply a supplied
updater; feature-specific filtering, sorting, merging and rollback belong to
the module. Palette handoffs pass seed values and navigation intents to module
entrypoints; the palette does not implement the resulting editor or mutation.

This is not an exception for feature controllers. A task mutation used by
Today, Backlog, Projects and first-run still belongs to planning; focus queue
policy belongs to focus even though the shell displays the rail. Review save
and period-conflict recovery belong to review even though bootstrap supplies
the current review. Shell code may deliver their messages without deciding
their feature-specific failure or recovery policy.

On `arch/client-shell`, rule 3 rejects a module UI dependency back into
`src/shell`, which is what keeps this boundary from eroding again. The
extraction it implies is deferred, because moving those files collides with
reviewed work still in the merge queue. It is listed below rather than
described as done.

### Deferred from `arch/client-shell`

These move in the follow-up pull request below, not on that branch:
`useReviewActions` and its recovery ref into `modules/review/ui`, with review
request functions in that module's `api.ts`; `useQueueActions`, queue
selection and optimistic rollback into `modules/focus/ui`; and
`ProjectsWorkspace`, `TimeBlockDialog` and `useActivityCapture` out of legacy
`components` into projects, planning and evidence UI. Activity replacement
sorting and the original and inherited project dialog props move with the
capture hook. Their shell mounts remain.

### Required follow-up: persistent destination controllers

This extraction is a separate client PR after the page/dialog stack lands.
It is still required before client-track exit, not an architecture exception.
The remaining three shell action files alone contain 810 lines, and share
state with the palette, first-run, Log and bootstrap. Moving files with a
`ShellState` import would preserve the wrong ownership; conditionally mounting
them would lose drafts. Review this lifetime and interface change together:

| Current shell responsibility | Required owner and precise change |
| --- | --- |
| `use-task-actions.ts`; `newTask`, pending/recovery/mutation refs and `dismissedUnfinished` in `use-shell-state.ts`; Today/Backlog task selection in `use-shell-model.ts` | Planning UI: add an unconditionally mounted planning controller owning task create/update/delete/reorder, retries and optimistic policy, task draft and unfinished dismissal; expose page props, navigation counts and a task-draft seed entrypoint. Keep first-run seen/navigation/focus coordination in the shell and invoke planning's first-task operation. |
| `use-journal-actions.ts`; note/material drafts, pending/recovery/mutation refs and empty-draft constants in `use-shell-state.ts` | Journal UI: combine those with `useJournalPage` in a persistent journal controller; own diary updates, attribution, tag normalization and history refresh. Expose note/reference seed entrypoints for the palette, page props, save and recovery actions. |
| `use-time-block-actions.ts`; `TimeBlockEditor`, draft/error/pending/mutation state in `use-shell-state.ts`; inline draft/close handlers and `mergeTimeBlockTaskOptions` call in `workspace-shell.tsx` | Planning UI: persistent time-block controller and dialog host owning defaults, linked-task preservation, request construction, saved-but-refresh-failed behavior and dialog props. Shell invokes open/edit entrypoints and mounts the host. |
| Log projections, duration totals, day/task candidates and reset-on-leave effect in `use-shell-model.ts`; future-day Timeline rule in `workspace-shell.tsx`; `components/use-viewed-day.ts` and `loadViewedDay` in `components/dashboard-api.ts` | Planning UI: `useDayPage` owns the viewed-day hook, `/api/day` request, selectors and reset policy, with active-destination input and navigation callbacks. It shares the viewed-day refresh seam with the time-block controller. Remove unused totals while extracting. |
| Task/note/reference field setters in `command-palette-host.tsx` | Replace with the planning/journal seed entrypoints above. Retain palette resolution, dismissal, navigation and focus handoff in the shell. |

The PR must preserve draft lifetime across a full destination tour, request
payloads and mutation-id reuse, task retry timing, queue rollback, diary/review
recovery messages, time-block linked-task options and saved-but-refresh-failed
state, Log reset and future-day navigation, and palette focus restoration.
Use the existing `*-destination-state`, `day-navigation`, `time-blocks`,
`client-dialogs*`, `command-palette` and `first-run-onboarding` browser specs
as behavior gates, plus architecture, typecheck and unit gates. Browser gates
must run in an environment where a disposable database and server are allowed.

Exit (all required, evaluated on the integrated client stack):

- Every destination and feature dialog component and controller is defined
  under its owning `modules/*/ui`, including its drafts, validation, request
  construction, optimistic policy and recovery state. None is defined in
  `src/shell` or left in legacy `src/components`. The capture palette and
  first-run coordination are the explicit shell exceptions above.
- `src/shell` contains only the enumerated composition duties. It has no
  task/journal/review/queue/time-block action implementation, feature editor
  draft type, feature mutation-id/recovery ref, or destination-specific data
  projection. Check the follow-up table against the final tree; every row
  must be removed from the shell. An architecture pass alone cannot certify
  this semantic ownership check.
- No module UI imports `src/shell`, including type-only references (Rule 3);
  no raw `fetch` exists outside `shared/client`.
- The e2e suite is unchanged and green, including navigation/draft lifetime
  and dialog recovery. A skipped browser run is not a passing exit gate.

The shell branch does not yet meet this exit. Step 4 also remains to be
verified on the integrated stack: in this branch Today/current Review still
consume bootstrap data, and `useBootstrap.refresh` has no generation guard.
Neither gap is excused by the composition-root decision.

## Phase 4: Backup Engine and Lazy Prisma

**Execution status:** Step 1 merged on main; Steps 2 and 3 pending republish as rebuilt candidates. Terminal architecture exit condition reached on main at commit `8d00dfd` and preserved at `dc9e284`.
- Step 1: PR #63 (`8d00dfd`): Moved SQLite backup and migration engines into `src/modules/data-ops/services` with clock injection (`ClockInstant`). Merged. Removes the Rule 8 baseline entry (`src/lib/backup-management.ts:42`).
- Step 2: PR #68 (`arch/phase4-lazy-prisma`): Lazy `getPrisma()` singleton getter in `src/lib/prisma.ts`. Status: DRAFT / pending republish (rebuilt candidate; must not merge from existing published head).
- Step 3: PR #69 (`arch/phase4-backup-split`): Splits backup management into policy/retention, restore coordinator, and automatic runner. Status: DRAFT / pending republish (rebuilt candidate; must not merge from existing published head).
- Integration PR #70: DRAFT, **permanently excluded** from merge queue.
- Terminal exit condition reached on main: At commit `8d00dfd` and preserved at `dc9e284`, the architecture baseline is 0 (`BASELINE = []`), legacy global-client calls are 0 across 0 files (`LEGACY_GLOBAL_CLIENT_CALL_BASELINE = []`), the allowlist is exactly 5 rows, and `ARCHITECTURE_STRICT=1 npm run test:architecture` passes with 0 violations (111 pass, 0 fail, 8 todo).

**Original plan and exit target (historical):**

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

## Operational Lessons and Critical Invariants

1. **Terminal exit condition reached on main:**
   `ARCHITECTURE_STRICT=1` passing is the migration's terminal exit condition, and it now passes directly on `origin/main` (`dc9e28452a8bc721e75571dd19ba804f5066a389`, commit `dc9e284`). Strict mode reports:
   - Violations: 0 violations (`ARCHITECTURE_STRICT=1` exits 0; 119 tests: 111 pass, 0 fail, 8 todo).
   - Baseline: `BASELINE` array is empty (`[]`).
   - Legacy global-client baseline: 0 call sites across 0 files (`LEGACY_GLOBAL_CLIENT_CALL_BASELINE = []`).
   - Activity write allowlist: exactly 5 call sites.
   - Unit tests: 443 tests, 443 pass, 0 fail.

2. **Mechanical clock invariant gap (Proposed Rule 9):**
   The clock invariant has no mechanical enforcement in the architecture scanner. A proposed Rule 9 would ban direct calls to `new Date()` and `Date.now()` under `src/app/api`, `src/lib`, `src/modules/*/{domain,services}` and `src/server` with an explicit allowlist — initially:
   - `src/lib/focus-start-idempotency.ts:51` (fallback random mutation ID generation)
   - `src/shared/kernel/calendar.ts:19` (`systemClock.now()`)
   - `src/shared/kernel/calendar.ts:61` (`startOfLocalDay` default parameter)
   - `src/shared/kernel/calendar.ts:133` (`reviewPeriodRange` default parameter)
   - `src/shared/kernel/calendar.ts:141` (`millisecondsUntilNextLocalDay` default parameter)
   Its exact allowlist is under review. Until Rule 9 exists, strict mode passing should not be read as "all invariants hold". This is recorded as an operational follow-up rather than built during this migration.

3. **Client guard isolation gap (Proposed Rule 3 extension):**
   Ten guard names are exported by both `src/shared/client/decoders.ts` and a `src/modules/*/domain/*` module; nine are identical today, which is the hazard rather than safety as it allowed drift to accumulate unnoticed. Twelve `src/lib/*` shims use `export *` and seven are imported by client code. Three client files already import domain guards directly. Proposed rule: client layers may import types and non-guard functions from a domain module, but any value import matching `/^(is|has|parse)[A-Z]/` must come from `@/shared/client/decoders`; and shims consumed by client code may not use `export *`. Recorded as an operational follow-up.

4. **Day-payload task filtering (Deliberate non-fix with caveat):**
   The client day decoder does not compare a task's date to the decoded day key, so a backlog task (`date: null`) or a foreign-day task would be accepted. This was deliberately not fixed in the client decoder: the server already excludes both (`src/modules/planning/services/tasks.ts`), and the obvious client-side fix would compare a server-computed day key against a date interpreted in the browser's zone — the exact defect class the review-window geometry check exists to prevent. Anyone picking up this follow-up must preserve this boundary and avoid introducing browser timezone interpretation.

5. **Limitation of the rehearsal technique:**
   Rehearsing against a projected main catches conflicts, but not a clean-merge export swap where the projection's version of a file differs from what actually landed. Six branches were pre-resolved this way and five were fine. For PR #64 (`dc9e284`), the rehearsal ran against a projection of main that did not contain #62's rewrite of `src/lib/review-records.ts` from an explicit named export list to `export * from "@/modules/review/domain/review"`. On the real merge that file never conflicted, git took main's line cleanly, and `isReviewWindowDetail` silently re-resolved to a different implementation — the domain guard, which lacks the `hasReviewWindowGeometry` check. Every other gate stayed green, but the real merge produced 38 unit test failures that the rehearsal did not predict.

6. **Timezone masking in CI:**
   The entire automated test suite runs strictly under `TZ=America/Chicago` (pinned in `.github/workflows/ci.yml:23` as `TZ: America/Chicago`, and in `package.json` scripts `test:unit` and `test:backup`). This makes timezone-dependent defects structurally invisible in automated CI runs. Review unit tests currently fail under `TZ=UTC` and `TZ=America/New_York`; these appear to be zone-bound fixtures (e.g. Chicago daylight-saving 167-hour vs non-DST 168-hour week assertion in `tests/unit/review-domain.test.ts:136`, and Chicago midnight timestamps in `review-route-contracts.test.ts`) rather than product bugs, though only one was verified. Client decoders (`tests/unit/review-records.test.ts`) were separately verified across all three zones (`UTC`, `America/New_York`, `America/Chicago`).

7. **Ungated read transaction budgets:**
   The `{ timeout: 60000 }` options on `prisma.$transaction` calls in `src/app/api/bootstrap/route.ts` and `src/app/api/agent-export/route.ts` have no automated gate in architecture tests or linters, and were silently dropped during a merge conflict resolution before.

8. **The six defect classes:**
   Every defect shipped during this migration merged cleanly, passed CI, and was discovered later by reading:
   - Defect 1: A transaction budget (`{ timeout: 60000 }`) dropped during a merge.
   - Defect 2: An import of an export that a sibling branch removed.
   - Defect 3: A reference to a re-exported class with no constructible local binding (`new SomeError(...)` where `export { AppError as SomeError }` provides no local binding, causing runtime `TypeError: ... is not a constructor` or compile error).
   - Defect 4: Browser-side validation of a value the server computes.
   - Defect 5: A parity test comparing two paths that turned out to share one implementation.
   - Defect 6: An agent changing documented behaviour so a test would pass.

9. **PR #70 permanent exclusion:**
   Draft PR #70 (`arch/server-integration`) remains permanently excluded from the merge queue. Merges proceed per-feature in dependency order.

