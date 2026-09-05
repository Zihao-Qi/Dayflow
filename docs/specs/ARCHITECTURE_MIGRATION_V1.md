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
5. **No fallback to the global client.** In any file under `src/` that
   imports the global-client binding, by its own name or an alias, a
   parameter initializer containing that binding, or a `??`, `||`, `??=`
   or `||=` fallback to it, is rejected.
6. **Transaction roots.** A direct call to a property named `$transaction`
   is permitted only under `src/app/api`, `src/server`, and the idempotency
   helper: today `src/lib/idempotent-mutations.ts`, later
   `src/server/prisma/run-once.ts`.
7. **Activity writes.** Every direct call whose receiver property is
   `activityEntry` and whose method is `create`, `createMany`, `upsert`,
   `update` or `updateMany` under `src/`, and every string or template
   literal containing `INSERT INTO`, `INSERT OR REPLACE INTO`,
   `INSERT OR IGNORE INTO` or `UPDATE` against `ActivityEntry`, must be in
   the test's allowlist, and the allowlist must contain nothing else. The
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

Exactly five keys: `src/app/api/activities/route.ts:34:activityEntry.create`,
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
