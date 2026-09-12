import json
import unittest
from common import (
    MergeGateTestCase,
    DEFAULT_HEAD_SHA,
    DEFAULT_BASE_SHA,
    DEFAULT_PR_NUMBER,
    DEFAULT_REPO,
    fingerprint,
    make_check_runs
)

class TestGateMerge(MergeGateTestCase):

    def test_clean_ready_merge_end_to_end(self):
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Clean refactor verified",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 0, f"gatemerge failed: {r.stdout}\n{r.stderr}")
        expected_line = f"#{DEFAULT_PR_NUMBER} head={DEFAULT_HEAD_SHA[:7]} base={DEFAULT_BASE_SHA[:7]} behind=0 gate=ready"
        self.assertIn(expected_line, r.stdout)

        # Check files created in isolated state dir
        live_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-live.json"
        ev_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-evidence.json"
        gated_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-gated.json"
        merge_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json"

        self.assertTrue(live_file.exists())
        self.assertTrue(ev_file.exists())
        self.assertTrue(gated_file.exists())
        self.assertTrue(merge_file.exists())

        ev = json.loads(ev_file.read_text())
        self.assertEqual(ev["verdict"], "clean")
        self.assertEqual(ev["reviewer"], "Codex")
        self.assertEqual(ev["findings"], [])

        merge_data = json.loads(merge_file.read_text())
        self.assertEqual(merge_data["decision"], "merged")
        self.assert_merge_attempted(expected_head=DEFAULT_HEAD_SHA)

    def test_dry_run_ready_never_merges(self):
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Dry run test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z",
            "--dry-run"
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn(f"#{DEFAULT_PR_NUMBER} head={DEFAULT_HEAD_SHA[:7]} base={DEFAULT_BASE_SHA[:7]} behind=0 gate=ready", r.stdout)

        gated_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-gated.json"
        merge_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json"
        self.assertTrue(gated_file.exists())
        self.assertFalse(merge_file.exists())
        self.assert_no_merge_attempted()

    def test_dry_run_blocked_exits_zero(self):
        # PR behind main
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/compare/{DEFAULT_BASE_SHA}...{DEFAULT_HEAD_SHA}"],
            {"behind_by": 3, "status": "diverged"}
        )
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Dry run blocked",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z",
            "--dry-run"
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn("behind=3 gate=blocked Head does not contain current main", r.stdout)
        merge_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-merge.json"
        self.assertFalse(merge_file.exists())
        self.assert_no_merge_attempted()

    def test_non_dry_run_blocked_exits_three(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/compare/{DEFAULT_BASE_SHA}...{DEFAULT_HEAD_SHA}"],
            {"behind_by": 1, "status": "diverged"}
        )
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Blocked gate test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 3)
        self.assertIn("behind=1 gate=blocked Head does not contain current main", r.stdout)
        self.assert_no_merge_attempted()

    def test_untriaged_findings_refusal_exits_two(self):
        self.set_route(
            ["api", "graphql"],
            {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": [{
                                    "id": "PRRT_kwDO_UNRESOLVED",
                                    "isResolved": False,
                                    "isOutdated": False,
                                    "comments": {
                                        "nodes": [],
                                        "pageInfo": {"hasNextPage": False, "endCursor": None}
                                    }
                                }],
                                "pageInfo": {"hasNextPage": False, "endCursor": None}
                            }
                        }
                    }
                }
            },
            match="graphql"
        )
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Untriaged test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 2)
        out = r.stdout + r.stderr
        self.assertIn("REFUSING: findings need explicit --triage:", out)
        self.assertIn("PRRT_kwDO_UNRESOLVED", out)
        self.assert_no_merge_attempted()

    def test_triaged_findings_allows_merge(self):
        thread_id = "PRRT_kwDO_RESOLVED"
        self.set_route(
            ["api", "graphql"],
            {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": [{
                                    "id": thread_id,
                                    "isResolved": False,
                                    "isOutdated": False,
                                    "comments": {
                                        "nodes": [],
                                        "pageInfo": {"hasNextPage": False, "endCursor": None}
                                    }
                                }],
                                "pageInfo": {"hasNextPage": False, "endCursor": None}
                            }
                        }
                    }
                }
            },
            match="graphql"
        )
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Triaged test",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z",
            "--triage", f"{thread_id}::fixed::Addressed in review"
        )
        self.assertEqual(r.returncode, 0, f"Failed: {r.stdout}\n{r.stderr}")
        self.assertIn(f"#{DEFAULT_PR_NUMBER} head={DEFAULT_HEAD_SHA[:7]} base={DEFAULT_BASE_SHA[:7]} behind=0 gate=ready", r.stdout)

        ev_file = self.state_dir / f"pr{DEFAULT_PR_NUMBER}-evidence.json"
        ev = json.loads(ev_file.read_text())
        self.assertEqual(len(ev["triage"]), 1)
        self.assertEqual(ev["triage"][0]["id"], thread_id)
        self.assertEqual(ev["triage"][0]["disposition"], "fixed")
        self.assertEqual(ev["triage"][0]["reason"], "Addressed in review")
        self.assert_merge_attempted(expected_head=DEFAULT_HEAD_SHA)

    def test_inspect_failure_exits_one(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/pulls/{DEFAULT_PR_NUMBER}"],
            {},
            exit_code=1,
            stderr="500 Internal Server Error"
        )
        r = self.run_gatemerge(
            str(DEFAULT_PR_NUMBER),
            "--summary", "Inspect fail",
            "--reviewer", "Codex",
            "--reviewed-at", "2026-09-11T12:00:00Z"
        )
        self.assertEqual(r.returncode, 1)
        self.assertIn("inspect failed:", r.stdout)
        self.assert_no_merge_attempted()
