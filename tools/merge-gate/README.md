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
on a real merge, `pr<N>-merge.json`. Every step deletes its own output file before
running and refuses to continue unless that run rewrote it, so a file left by an
earlier run can never be read as a fresh snapshot, a fresh `ready`, or a merge
that did not happen. Archiving previous runs is still worth doing as a record.

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
- Every `queue.py` call is checked: a non-zero exit, or an output file this run
  did not write, stops the wrapper instead of reusing a retained file.

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
PRs #84 through #110 — the last thing they gated was the merge that brought
them into this repository. `queue.py` did that alone at first: #84, #90 and #92
were gated before `gatemerge.py` existed, and the wrapper was written on
2026-09-07 at 11:29, minutes before it gated #94. That directory is not
durable: `queue.py` once vanished mid-migration and had to be recovered
byte-for-byte from an archived transcript. Packaging the pair here is what
fixes that.

The archive was copied to `~/.local/state/dayflow-merge-gate/archive` during the
cutover. Only part of it survived to be copied: macOS had already reaped the
records for #84 through #104 from `/tmp`, which is the hazard this packaging
exists to remove. What is preserved, 22 files — 116K of allocated blocks,
about 55 KiB of actual content:

| Content | Files |
|---|---|
| `queue.py`, `gatemerge.py` | 2 |
| `pr<N>-evidence.json`, `pr<N>-gated.json`, `pr<N>-merge.json`, `pr<N>-live.json` | 5 each |

Those five are #105, #107, #108, #109 and #110. The `legacy/` and
`__pycache__/` directories came across empty.

The merge records for the PRs before them are absent from both the archive and
`/private/tmp`. Do not read that as total loss: the evidence for #84, #90 and
#92 survives verbatim in this machine's Claude session transcript, where it was
written as a heredoc and can be recovered the same way `queue.py` once was. For
#94 through #104 the transcript holds only directory listings — names and byte
counts, not content — so those records are genuinely unrecoverable.

- `queue.py` sha256 `4887f62c94646dfe4a0f1993db5b0a8f3008bd54a7c5e4e84512da999a920a8b`, copied here byte for byte.
- `gatemerge.py` sha256 `e3e821a79cfdbff83d9bb6f4845cb86889e5f459f354e24a750b7a500e1af23b` is the
  archived original. The copy here locates `queue.py` beside itself, writes state
  outside the checkout, and refuses to read an output file an earlier run left
  behind — the last of those fixes two defects the review of #110 found, which
  the archived original still has.

The cutover happened when #110 merged: this copy is the canonical merge path,
and `/private/tmp/dayflow-resume-queue` is not. That directory is left in place
but nothing depends on it, and `/tmp` will eventually empty it.

## Where the durable copies live

- The tool: `tools/merge-gate/` in this repository, which is what CI tests and
  what every merge should use.
- The evidence: `~/.local/state/dayflow-merge-gate/archive`, copied from
  `/private/tmp/dayflow-resume-queue` and verified byte-identical at the time.
- New runs: `~/.local/state/dayflow-merge-gate`, or wherever
  `$DAYFLOW_MERGE_GATE_STATE` points. Keep it unset for normal use so state
  survives a reboot.

Evidence accumulates in the state directory as PRs are gated. It is the record
of why each merge was allowed, so move it somewhere durable rather than leaving
it anywhere `/tmp`-like.
