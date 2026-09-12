import json
import os
import shutil
import unittest
from common import (
    MergeGateTestCase,
    DEFAULT_HEAD_SHA,
    DEFAULT_BASE_SHA,
    DEFAULT_PR_NUMBER,
    DEFAULT_REPO,
    QUEUE_PATH,
    GATEMERGE_PATH
)

class TestRelocation(MergeGateTestCase):

    def test_run_from_arbitrary_cwd_with_custom_state_dir(self):
        # Relocate queue.py and gatemerge.py to a completely separate directory outside repo
        relocated_dir = self.test_dir / "relocated_tools"
        relocated_dir.mkdir()
        relocated_queue = relocated_dir / "queue.py"
        relocated_gatemerge = relocated_dir / "gatemerge.py"
        shutil.copy2(QUEUE_PATH, relocated_queue)
        shutil.copy2(GATEMERGE_PATH, relocated_gatemerge)

        # Create an arbitrary working directory
        arbitrary_cwd = self.test_dir / "arbitrary_cwd"
        arbitrary_cwd.mkdir()

        # Run from arbitrary cwd pointing to relocated gatemerge
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Relocated run",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z",
            cwd=arbitrary_cwd,
            gatemerge_bin=relocated_gatemerge
        )
        self.assertEqual(r.returncode, 0, f"Failed: {r.stdout}\n{r.stderr}")
        self.assertIn("gate=ready", r.stdout)

        # Assert files landed in self.state_dir (DAYFLOW_MERGE_GATE_STATE)
        self.assertTrue((self.state_dir / f"pr{DEFAULT_PR_NUMBER}-live.json").exists())
        self.assertTrue((self.state_dir / f"pr{DEFAULT_PR_NUMBER}-evidence.json").exists())
        self.assertTrue((self.state_dir / f"pr{DEFAULT_PR_NUMBER}-gated.json").exists())
        self.assertTrue((self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json").exists())

        # Assert no output files leaked into arbitrary_cwd
        cwd_files = list(arbitrary_cwd.iterdir())
        self.assertEqual(cwd_files, [], f"Files leaked into arbitrary cwd: {cwd_files}")

        # Assert no output files leaked into relocated script directory
        relocated_files = set(p.name for p in relocated_dir.iterdir())
        self.assertEqual(relocated_files, {"queue.py", "gatemerge.py"})

        self.assert_merge_attempted(expected_head=DEFAULT_HEAD_SHA)

    def test_stale_gated_json_cannot_authorize_merge_after_failed_inspect(self):
        # Pre-seed a stale gated.json claiming ready
        stale_gated = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-gated.json"
        stale_gated.write_text(json.dumps({
            "number": DEFAULT_PR_NUMBER,
            "decision": "ready",
            "reason": "Stale authorization from prior run"
        }, indent=2))

        # Make inspect fail the gate (behind main)
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/compare/{DEFAULT_BASE_SHA}...{DEFAULT_HEAD_SHA}"],
            {"behind_by": 2, "status": "diverged"}
        )

        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Stale gated test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 3)
        self.assertIn("behind=2 gate=blocked Head does not contain current main", r.stdout)

        # Verify gated.json was overwritten with blocked decision, not kept stale
        current_gated = json.loads(stale_gated.read_text())
        self.assertEqual(current_gated["decision"], "blocked")
        self.assertIn("Head does not contain current main", current_gated.get("reason", ""))

        # Verify merge was never called and merge file does not exist
        merge_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json"
        self.assertFalse(merge_file.exists())
        self.assert_no_merge_attempted()

    def test_stale_merge_json_not_mistaken_for_dry_run_success(self):
        # Pre-seed a stale merge.json
        stale_merge = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json"
        stale_merge.write_text(json.dumps({
            "decision": "merged",
            "merge_commit_sha": "stale_old_merge_sha"
        }, indent=2))

        # Make current gate blocked
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/compare/{DEFAULT_BASE_SHA}...{DEFAULT_HEAD_SHA}"],
            {"behind_by": 5, "status": "diverged"}
        )

        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Stale merge test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 3)
        self.assert_no_merge_attempted()
