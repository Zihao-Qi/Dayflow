#!/usr/bin/env python3
"""Build pinned evidence from a live inspect snapshot, then gate and merge.

SHAs and discussion fingerprints are read from the snapshot, never typed by hand.
Any discussion that counts as a finding must be triaged explicitly via --triage.

`queue.py` is located beside this file, so the pair can be copied or run from
anywhere. Runtime snapshots and evidence are written to a state directory
outside the checkout: $DAYFLOW_MERGE_GATE_STATE when set, otherwise
~/.local/state/dayflow-merge-gate. Each step clears its own output file first
and refuses to read one a failed run left behind.
"""
import json, os, pathlib, subprocess, sys, argparse

HERE = pathlib.Path(__file__).resolve().parent
QUEUE = HERE / "queue.py"
STATE_ENV = "DAYFLOW_MERGE_GATE_STATE"
DEFAULT_STATE = pathlib.Path("~/.local/state/dayflow-merge-gate")

def state_directory():
    configured = os.environ.get(STATE_ENV)
    root = pathlib.Path(configured).expanduser() if configured else DEFAULT_STATE.expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root

def run(args):
    return subprocess.run([sys.executable, str(QUEUE), *args],
                          capture_output=True, text=True)

def run_to(output, args, what):
    """Run queue.py and read `output` only when this run actually wrote it.

    queue.py writes its --output file on success only, so a file retained from
    an earlier run for the same PR would otherwise be read as a fresh result:
    a stale snapshot, a stale `ready`, or a merge that never happened.
    """
    output.unlink(missing_ok=True)
    r = run([*args, "--output", str(output)])
    if r.returncode != 0 or not output.exists():
        print(f"{what} failed:", r.stdout, r.stderr)
        sys.exit(1)
    return json.loads(output.read_text())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("number", type=int)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--reviewer", required=True)
    ap.add_argument("--reviewed-at", required=True)
    ap.add_argument("--triage", action="append", default=[],
                    help="id::disposition::reason for any discussion needing one")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    state = state_directory()
    snap = state / f"pr{a.number}-live.json"
    s = run_to(snap, ["inspect", str(a.number)], "inspect")

    triage_in = {}
    for t in a.triage:
        i, disp, reason = t.split("::", 2)
        triage_in[i] = (disp, reason)

    ev = {
        "number": s["number"],
        "head_sha": s["head_sha"],
        "base_sha": s["base_sha"],
        "verdict": "clean",
        "reviewer": a.reviewer,
        "reviewed_at": a.reviewed_at,
        "summary": a.summary,
        "findings": [],
        "discussion_fingerprints": {d["id"]: d["fingerprint"] for d in s["discussions"]},
        "triage": [
            {"id": d["id"], "fingerprint": d["fingerprint"],
             "disposition": triage_in[d["id"]][0], "reason": triage_in[d["id"]][1]}
            for d in s["discussions"] if d["id"] in triage_in
        ],
    }
    untriaged = [d["id"] for d in s["discussions"]
                 if ((d["kind"] == "thread" and not d.get("resolved"))
                     or (d["kind"] == "review" and d.get("state") == "CHANGES_REQUESTED"))
                 and d["id"] not in triage_in]
    if untriaged:
        print("REFUSING: findings need explicit --triage:", untriaged); sys.exit(2)

    evp = state / f"pr{a.number}-evidence.json"
    evp.write_text(json.dumps(ev, indent=2))

    gated = run_to(state / f"pr{a.number}-gated.json",
                   ["inspect", str(a.number), "--evidence", str(evp)],
                   "gated inspect")
    print(f"#{a.number} head={s['head_sha'][:7]} base={s['base_sha'][:7]} "
          f"behind={s.get('behind_by')} gate={gated['decision']} {gated.get('reason') or ''}")
    if gated["decision"] != "ready" or a.dry_run:
        sys.exit(0 if a.dry_run else 3)

    merge_path = state / f"pr{a.number}-merge.json"
    run_to(merge_path, ["merge", str(a.number), "--expected-head", s["head_sha"],
                        "--expected-base", s["base_sha"], "--evidence", str(evp)],
           "merge")
    print(merge_path.read_text().strip()[:200])

main()
