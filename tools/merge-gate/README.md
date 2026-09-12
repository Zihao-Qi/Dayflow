# Merge gate

Two Python files, standard library only, that decide whether a pull request may
merge and then merge it. They exist because merging this repository requires
evidence that a human or another model actually reviewed the exact commit being
merged, and because a green CI run alone is not that evidence.

- `queue.py` — inspects a pull request through `gh`, decides `ready` or
  `blocked`, and performs the merge. `inspect` never mutates anything.
- `gatemerge.py` — builds pinned evidence from a live inspect snapshot, refuses
  to continue while any discussion is untriaged, then re-inspects with that
  evidence and merges when the decision is `ready`.

## Running it

```sh
python3 tools/merge-gate/gatemerge.py <pr-number> \
  --summary "<what changed and how it was verified>" \
  --reviewer "<who reviewed it, and how>" \
  --reviewed-at "<ISO 8601 UTC>" \
  [--triage "<discussion-id>::fixed|obsolete|not-actionable::<reason>"] \
  [--dry-run]
```

Run `--dry-run` first and read the printed decision. `--dry-run` always exits 0,
so the decision line and `pr<N>-gated.json` are the result, not the exit code.
Without `--dry-run` the exit code is 3 when the gate is not `ready`.

`gatemerge.py` finds `queue.py` beside itself, so the pair can be copied
anywhere and run from any working directory.

## State directory

Snapshots and evidence are runtime state, not source, so they are never written
into the checkout:

- `$DAYFLOW_MERGE_GATE_STATE` when set, which the tests use.
- otherwise `~/.local/state/dayflow-merge-gate`.

Each run writes `pr<N>-live.json`, `pr<N>-evidence.json`, `pr<N>-gated.json` and,
on a real merge, `pr<N>-merge.json`. Archive the previous files before rerunning,
and check that the new ones are freshly written: a stale `gated.json` read as a
fresh decision is exactly the failure this tooling exists to prevent.

## What must not be weakened

Each of these refusals was added after a real incident. Removing one silently is
the failure mode this file is here to prevent.

- Inspect never mutates. Mutations require full 40-character `--expected-head`
  and `--expected-base`, and the pair is re-pinned immediately before merging.
- The head must contain current `main` (`behind_by == 0`).
- The branch protection rule must be strict and must require `Reliability gates`.
- GitHub's own `mergeable_state` must be `clean`.
- Required checks must be complete and successful at the inspected head. A run
  cancelled by the workflow's concurrency group counts as superseded history
  only when a strictly later run for the same context at the same head
  succeeded. Every other cancellation still fails closed.
- Review evidence must name the inspected PR, head and base, must carry no
  findings, and must fingerprint every discussion. Any unresolved thread or
  `CHANGES_REQUESTED` review needs an explicit triage entry with a reason.
- A bot review is accepted only when it names the reviewed commit and that
  commit prefixes the inspected head.
- The historical exclusions stay: #70 is permanently excluded, and the old
  unreconstructed #68/#69 heads are blocked.
- Everything is re-fetched and re-gated immediately before the merge call.

## Tests

`tests/merge-gate/` holds Python `unittest` tests that drive both files with a
synthetic `gh` on `PATH` and a temporary state directory. No network, no
GitHub, no dependencies:

```sh
python3 -m unittest discover -s tests/merge-gate -t tests/merge-gate
```

CI runs the same command. The start and top directories are both
`tests/merge-gate`, because a hyphenated directory is not an importable module
name; that also means test files import sibling helpers as top-level modules.

## Provenance and archive

These files were run from `/private/tmp/dayflow-resume-queue` while merging
PRs #84 through #109. That directory is not durable: `queue.py` once vanished
mid-migration and had to be recovered byte-for-byte from an archived transcript.
Packaging the pair here is what fixes that.

At the time of this copy the archive held 76 files and 316K:

| Content | Files |
|---|---|
| `queue.py`, `gatemerge.py` | 2 |
| `pr<N>-evidence.json` | 16 |
| `pr<N>-gated.json` | 16 |
| `pr<N>-merge.json` | 16 |
| `pr<N>-live.json` | 14 |
| `pr<N>-update.json` | 5 |
| `pr<N>-inspect.json`, `pr<N>-inspect2.json` | 5 |
| `legacy/`, `__pycache__/` | 2 |

- `queue.py` sha256 `4887f62c94646dfe4a0f1993db5b0a8f3008bd54a7c5e4e84512da999a920a8b`, copied here byte for byte.
- `gatemerge.py` sha256 `e3e821a79cfdbff83d9bb6f4845cb86889e5f459f354e24a750b7a500e1af23b`. The copy here differs only in locating `queue.py` beside itself and writing state outside the checkout.

Until this candidate has been reviewed and cut over deliberately, the
`/private/tmp` copies remain the canonical merge path and must be left
untouched, evidence JSON included. The past evidence files stay there; they are
merge records for commits already on `main`, not something to re-create here.

## Installing the durable copy

1. Verify the source hashes above against `/private/tmp/dayflow-resume-queue`.
2. Copy the archive itself (all 76 files) somewhere durable, outside `/tmp`,
   preserving names. It is the record of how every merged PR was gated.
3. Use `tools/merge-gate/gatemerge.py` from the checkout for new merges.
4. Keep `$DAYFLOW_MERGE_GATE_STATE` unset for normal use so state lands in
   `~/.local/state/dayflow-merge-gate`, which survives reboots.
