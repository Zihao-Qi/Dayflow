#!/usr/bin/env python3
"""Build pinned evidence from a live inspect snapshot, then gate and merge.

SHAs and discussion fingerprints are read from the snapshot, never typed by hand.
Any discussion that counts as a finding must be triaged explicitly via --triage.

`queue.py` is located beside this file, so the pair can be copied or run from
anywhere. Runtime snapshots and evidence are written to a state directory
outside the checkout: $DAYFLOW_MERGE_GATE_STATE when set, otherwise
~/.local/state/dayflow-merge-gate.
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
    r = subprocess.run([sys.executable, str(QUEUE), *args],
                       capture_output=True, text=True)
    return r

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
    r = run(["inspect", str(a.number), "--output", str(snap)])
    if not snap.exists():
        print("inspect failed:", r.stdout, r.stderr); sys.exit(1)
    s = json.loads(snap.read_text())

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

    g = run(["inspect", str(a.number), "--evidence", str(evp),
             "--output", str(state / f"pr{a.number}-gated.json")])
    gated = json.loads((state / f"pr{a.number}-gated.json").read_text())
    print(f"#{a.number} head={s['head_sha'][:7]} base={s['base_sha'][:7]} "
          f"behind={s.get('behind_by')} gate={gated['decision']} {gated.get('reason') or ''}")
    if gated["decision"] != "ready" or a.dry_run:
        sys.exit(0 if a.dry_run else 3)

    m = run(["merge", str(a.number), "--expected-head", s["head_sha"],
             "--expected-base", s["base_sha"], "--evidence", str(evp),
             "--output", str(state / f"pr{a.number}-merge.json")])
    print((state / f"pr{a.number}-merge.json").read_text().strip()[:200])

main()
