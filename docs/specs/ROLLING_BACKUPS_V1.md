# Rolling Automatic Backups v1

Status: Proposed
Date: August 22, 2026

> **Backup contract:** [Local Data Reliability v1](./LOCAL_DATA_RELIABILITY_V1.md)
> remains authoritative for what a backup contains, how artifacts are written
> and validated, and how restore behaves.
>
> **Supersedes one non-goal:** [Migration Safety Backups v1](./MIGRATION_SAFETY_BACKUPS_V1.md)
> listed "scheduled or rolling backups, retention limits, pruning, or settings
> UI" as a non-goal. This specification takes up that item.

## Purpose

Dayflow can already create a verified backup, but only when the user
remembers to. The data most worth protecting belongs to someone who is busy
using the app, not administering it.

Rolling automatic backups make protection the default outcome of ordinary use,
without turning Dayflow into something that manages itself behind the user's
back. The feature is opt-in, its schedule is visible, and in v1 it deletes
nothing at all.

## Language

Two terms are added to [the domain language](../../CONTEXT.md).

**Automatic Backup**:
A verified backup artifact Dayflow created on its own schedule rather than in
response to an explicit request. It is identical in format and validation to a
manual backup and differs only in why it exists.
_Avoid_: Snapshot, autosave, sync

**Backup Retention**:
The number of most-recent Automatic Backups the user wants to keep. In v1 it is
a stated preference Dayflow reports against; Dayflow does not delete anything to
satisfy it.
_Avoid_: Expiry, cleanup, quota, auto-delete

## Scope

- Let the user enable and disable Automatic Backups from **Data & backups**.
- Let the user choose an interval and a Backup Retention count within bounded
  ranges.
- Create an Automatic Backup when one is due, using the existing verified
  artifact path.
- Report how many Automatic Backups exceed Backup Retention, without deleting
  any of them.
- Report when the last Automatic Backup ran, whether it succeeded, and when the
  next one is due.
- Keep every existing manual backup, restore, and migration path unchanged.

## Policy

The policy is persisted as a single JSON document in the managed backup
directory, alongside the existing restore metadata files, and is read and
written only through the backup-management module.

```text
enabled          boolean, default false
intervalHours    integer, 1..168, default 24
retainCount      integer, 1..50, default 7
```

Automatic Backups are off until the user turns them on. An absent, unreadable,
or malformed policy document is treated as disabled rather than as a reason to
guess, matching how Dayflow refuses to guess an active database.

## Scheduling

An Automatic Backup is due when no successful Automatic Backup exists, or when
`intervalHours` have elapsed since the most recent successful one.

Due-checks run in the Node runtime:

- at startup, after any pending restore has been applied;
- on a bounded recurring check while the process runs, so a Dayflow left
  running for days still protects data.

A due-check never runs inside a request path. Backup work must not delay
serving the dashboard.

Only one backup operation runs at a time. Automatic Backups reuse the existing
single-operation guard rather than introducing a second one.

An Automatic Backup is skipped, not queued, when:

- the policy is disabled;
- a restore is pending or being applied;
- another backup operation is already running;
- the active database cannot be resolved.

## Retention Without Deletion

**v1 never deletes a backup artifact. No code path in this feature removes a
file.**

Backup Retention is a preference Dayflow reports against:

- **Data & backups** shows how many Automatic Backups exist and how many
  exceed the preference.
- Removing them is presented as the user's manual choice, with the managed
  directory named. Dayflow does not offer a one-click sweep.
- Changing the preference changes only what is reported.

This is deliberate sequencing, not an oversight. Deletion is the only
irreversible action this feature could take, and the pressure it would relieve
does not exist yet: a database of a few hundred kilobytes produces well under a
gigabyte of daily artifacts per year. Proving automatic creation against real
data is worth more than automating a cleanup nobody needs yet.

Deletion is specified as deferred work under Non-Goals, with its safety rules
written down so they are not rediscovered later.

## Reporting

**Data & backups** shows, for Automatic Backups:

- whether they are enabled, with the current interval and Backup Retention;
- when the last attempt ran and whether it succeeded;
- the reason for the most recent failure, without database internals;
- when the next one is due.

Automatic Backups appear in the existing backup list, labeled as automatic and
verified by the same checksum path as any other artifact. They can be
downloaded and restored exactly like a manual backup.

## Failure Behavior

An Automatic Backup is a background protection, never a gate.

- A failure must not prevent Dayflow from starting or serving requests.
- A failure must not mutate application records, and must leave any existing
  artifact untouched.
- A partially written artifact is never published; the existing atomic
  temporary-file-and-rename path is reused unchanged.
- Repeated failures do not accumulate retries. The next due-check is the next
  attempt.
- The most recent failure is persisted so the user can see it after a restart.

## Typed Failures

Policy mutations use the existing `{ code, error, field }` shape:

- `400 VALIDATION_ERROR`
  - a non-boolean `enabled`;
  - an `intervalHours` or `retainCount` that is not a whole number in range;
  - unknown policy fields.
- `409 CONFLICT`
  - a policy change attempted while a backup operation is running.
- `503 RESTORE_DISABLED`
  - unchanged, where the existing local data controls are disabled.

## Persistence and Performance

- No schema migration is required. No application table is read or written.
- Creating an Automatic Backup costs the same as a manual one and reads a
  consistent snapshot.
- Policy reads are a bounded file read, and are never performed per request.
- v1 performs no destructive file operation. Its tests still use a disposable
  database and a disposable backup directory outside the user's data path, so
  the suite stays safe to run and stays ready for deferred deletion work.

## Non-Goals

- Backing up anywhere other than the managed local directory. No cloud, no
  remote target, no off-machine copy.
- Encryption or password protection of artifacts.
- Automatic restore, or any automatic action that replaces data.
- Deleting, expiring, or touching any backup artifact.
- Backing up on every mutation, or continuous or streaming backup.
- A general application settings surface. This policy stays inside
  **Data & backups**.

### Deferred, not rejected

Enforcing Backup Retention by deleting old Automatic Backups is planned once
automatic creation has run against real data. When it is built, these rules
apply and were the reason it was deferred rather than rushed:

- deletion runs only after an Automatic Backup succeeds;
- only artifacts carrying the automatic purpose label are eligible, identified
  by label rather than by age, size, or directory position;
- manual, restore-safety, and migration-safety artifacts are never eligible,
  whatever their age or count;
- an artifact that fails verification is never counted toward retention and is
  never deleted, because a corrupt artifact is something to report, not to
  quietly remove;
- lowering the preference deletes nothing on its own; it takes effect at the
  next successful Automatic Backup, so a settings change is never destructive
  as an immediate side effect.

## Acceptance Criteria

1. Automatic Backups are disabled until the user enables them, and an absent or
   malformed policy reads as disabled.
2. An enabled policy creates an Automatic Backup when one is due, and none when
   one is not.
3. An Automatic Backup is byte-verifiable by the same checksum path as a manual
   backup, and is restorable through the existing flow.
4. Creating an Automatic Backup mutates no application record.
5. No code path in this feature deletes a backup artifact. A complete
   due-check-and-create cycle leaves every pre-existing artifact present,
   including Automatic Backups already beyond the retention preference.
6. The retention report counts only Automatic Backups and states how many
   exceed the preference.
7. Changing the retention preference changes only what is reported.
8. No Automatic Backup is attempted while a restore is pending or applying.
9. Two due-checks overlapping produce at most one Automatic Backup.
10. A failing Automatic Backup leaves Dayflow serving normally, leaves records
    unchanged, and leaves no partial artifact.
11. The most recent failure reason survives a restart and is shown without
    database internals.
12. Malformed policy mutations return typed 4xx responses and change no stored
    policy.
13. The Automatic Backup controls remain usable at phone, tablet, and desktop
    widths.

## Required Test Coverage

- Unit tests for policy parsing, defaults, bounds, unknown fields, and the
  malformed-reads-as-disabled rule.
- Unit tests for due-calculation across "never run", "not yet due", and "due".
- Unit tests for the retention report, including that it counts only automatic
  artifacts.
- A storage test asserting criterion 5 directly: a full due-check-and-create
  cycle, run against a directory already holding manual, safety, and
  beyond-retention automatic artifacts, leaves every one of them present.
- Storage tests, against a disposable database and backup directory, proving an
  Automatic Backup verifies and mutates no record.
- A storage test proving overlapping due-checks produce at most one artifact.
- A storage test proving no Automatic Backup is created while a restore is
  pending.
- Browser coverage for enabling, adjusting, and disabling the policy, the
  reported schedule, last-attempt state and retention report, a typed
  rejection, and phone-width layout.
- Existing backup, restore, migration, and startup gates remain green.
