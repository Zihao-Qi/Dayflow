import json
import unittest
from common import (
    MergeGateTestCase,
    DEFAULT_HEAD_SHA,
    DEFAULT_BASE_SHA,
    DEFAULT_PR_NUMBER,
    DEFAULT_REPO,
    fingerprint,
    make_check_runs,
    make_rules,
    build_default_routes
)

class TestQueue(MergeGateTestCase):

    def _setup_evidence_file(self, **kwargs):
        evidence_data = self.build_evidence(**kwargs)
        evidence_file = self.test_dir / "evidence.json"
        evidence_file.write_text(json.dumps(evidence_data, indent=2))
        return evidence_file

    def test_clean_ready_positive_inspect(self):
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        self.assertEqual(r.returncode, 0, f"inspect failed: {r.stderr}")
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "ready")
        self.assert_no_merge_attempted()

    def test_clean_ready_positive_merge(self):
        ev_file = self._setup_evidence_file()
        output_file = self.test_dir / "merge_out.json"
        r = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file),
            "--output", str(output_file)
        )
        self.assertEqual(r.returncode, 0, f"merge failed: {r.stderr}")
        data = json.loads(output_file.read_text())
        self.assertEqual(data.get("decision"), "merged")
        self.assert_merge_attempted(expected_head=DEFAULT_HEAD_SHA)

    def test_stale_head_refusal(self):
        stale_head = "1111111111111111111111111111111111111111"
        ev_file = self._setup_evidence_file(head_sha=stale_head)
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        self.assertEqual(r.returncode, 0)
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("stale PR/head/base", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_stale_base_refusal(self):
        stale_base = "2222222222222222222222222222222222222222"
        ev_file = self._setup_evidence_file(base_sha=stale_base)
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        self.assertEqual(r.returncode, 0)
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("stale PR/head/base", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_missing_required_check(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": []}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Missing required check: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_pending_required_check(self):
        pending_runs = make_check_runs(DEFAULT_HEAD_SHA, status="in_progress", conclusion=None)
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": pending_runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Required check pending/failed: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_failed_required_check(self):
        failed_runs = make_check_runs(DEFAULT_HEAD_SHA, status="completed", conclusion="failure")
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": failed_runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Required check pending/failed: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_wrong_head_required_check(self):
        other_head = "3333333333333333333333333333333333333333"
        runs = make_check_runs(other_head, status="completed", conclusion="success")
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Missing required check: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_wrong_app_required_check(self):
        runs = make_check_runs(DEFAULT_HEAD_SHA, app_id=99999, status="completed", conclusion="success")
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Missing required check: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_behind_main_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/compare/{DEFAULT_BASE_SHA}...{DEFAULT_HEAD_SHA}"],
            {"behind_by": 2, "status": "diverged"}
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Head does not contain current main", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_absent_strict_rule_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/rules/branches/main"],
            make_rules(strict=False)
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Expected strict server Reliability gates rule unavailable", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_missing_reliability_gates_context_rule_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/rules/branches/main"],
            make_rules(strict=True, required_contexts=[{"context": "some-other-check", "integration_id": 15368}])
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Expected strict server Reliability gates rule unavailable", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_non_main_target_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/pulls/{DEFAULT_PR_NUMBER}"],
            {
                "number": DEFAULT_PR_NUMBER,
                "state": "open",
                "draft": False,
                "merged": False,
                "head": {"sha": DEFAULT_HEAD_SHA},
                "base": {"ref": "feature/branch"},
                "mergeable_state": "clean",
                "html_url": f"https://github.com/{DEFAULT_REPO}/pull/{DEFAULT_PR_NUMBER}"
            }
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("PR target must be main", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_dirty_mergeable_state_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/pulls/{DEFAULT_PR_NUMBER}"],
            {
                "number": DEFAULT_PR_NUMBER,
                "state": "open",
                "draft": False,
                "merged": False,
                "head": {"sha": DEFAULT_HEAD_SHA},
                "base": {"ref": "main"},
                "mergeable_state": "dirty",
                "html_url": f"https://github.com/{DEFAULT_REPO}/pull/{DEFAULT_PR_NUMBER}"
            }
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("GitHub merge state is not clean", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_new_or_edited_discussion_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/issues/{DEFAULT_PR_NUMBER}/comments?per_page=100"],
            [[{
                "id": 5001,
                "body": "Unrecorded new comment",
                "user": {"login": "someone"},
                "created_at": "2026-09-11T12:05:00Z",
                "updated_at": "2026-09-11T12:05:00Z"
            }]],
            match="prefix"
        )
        ev_file = self._setup_evidence_file(discussions=[])
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("New or edited untriaged discussion/review activity", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_unresolved_untriaged_finding_refusal(self):
        thread_item = {
            "id": "PRRT_kwDOABC123",
            "kind": "thread",
            "resolved": False,
            "outdated": False,
            "comments": []
        }
        thread_item["fingerprint"] = fingerprint(thread_item)

        self.set_route(
            ["api", "graphql"],
            {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": [{
                                    "id": "PRRT_kwDOABC123",
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
        ev_file = self._setup_evidence_file(discussions=[thread_item], triage=[])
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Untriaged finding PRRT_kwDOABC123", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_triaged_finding_allowed(self):
        thread_item = {
            "id": "PRRT_kwDOABC123",
            "kind": "thread",
            "resolved": False,
            "outdated": False,
            "comments": []
        }
        thread_item["fingerprint"] = fingerprint(thread_item)

        self.set_route(
            ["api", "graphql"],
            {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": [{
                                    "id": "PRRT_kwDOABC123",
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
        triage_entry = {
            "id": thread_item["id"],
            "fingerprint": thread_item["fingerprint"],
            "disposition": "fixed",
            "reason": "Addressed in commit c026349"
        }
        ev_file = self._setup_evidence_file(discussions=[thread_item], triage=[triage_entry])
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "ready")

    def test_nonempty_review_findings_refusal(self):
        ev_file = self._setup_evidence_file(findings=["Found security regression"])
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Independent review has findings", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_pre_merge_drift_refusal(self):
        ev_file = self._setup_evidence_file()
        drift_main_sha = "4444444444444444444444444444444444444444"
        # Subsequent lookups return drifted SHA
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/git/ref/heads/main"],
            {"object": {"sha": drift_main_sha}}
        )
        # First lookup returns DEFAULT_BASE_SHA (consumed once)
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/git/ref/heads/main"],
            {"object": {"sha": DEFAULT_BASE_SHA}},
            once=True
        )

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assertIn("Expected head/base changed", r_merge.stderr)
        self.assert_no_merge_attempted()

    def test_api_500_failure_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/pulls/{DEFAULT_PR_NUMBER}"],
            {},
            exit_code=1,
            stderr="500 Internal Server Error"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        self.assertEqual(r.returncode, 2)
        self.assert_no_merge_attempted()

    def test_api_malformed_json_refusal(self):
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/pulls/{DEFAULT_PR_NUMBER}"],
            "not valid json {{{",
            exit_code=0
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        self.assertEqual(r.returncode, 2)
        self.assert_no_merge_attempted()

    def test_superseded_cancelled_check_allowed(self):
        runs = [
            {
                "id": 1001,
                "name": "Reliability gates",
                "head_sha": DEFAULT_HEAD_SHA,
                "app": {"id": 15368},
                "status": "completed",
                "conclusion": "cancelled",
                "html_url": "https://github.com/.../1001"
            },
            {
                "id": 1002,
                "name": "Reliability gates",
                "head_sha": DEFAULT_HEAD_SHA,
                "app": {"id": 15368},
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://github.com/.../1002"
            }
        ]
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "ready")

    def test_unsuperseded_cancelled_check_blocked(self):
        runs = [
            {
                "id": 1001,
                "name": "Reliability gates",
                "head_sha": DEFAULT_HEAD_SHA,
                "app": {"id": 15368},
                "status": "completed",
                "conclusion": "cancelled",
                "html_url": "https://github.com/.../1001"
            }
        ]
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/commits/{DEFAULT_HEAD_SHA}/check-runs?per_page=100&filter=latest"],
            [{"check_runs": runs}],
            match="prefix"
        )
        ev_file = self._setup_evidence_file()
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Required check pending/failed: Reliability gates", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_historical_exclusion_pr70(self):
        state = self.read_state()
        state["routes"] = build_default_routes(number=70)
        self.write_state(state)

        ev_file = self._setup_evidence_file(number=70)
        r = self.run_queue("inspect", "70", "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("#70 is permanently excluded from this migration queue", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", "70",
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_historical_exclusion_pr68_old_head(self):
        old_68_head = "b9ae268bde000000000000000000000000000000"
        state = self.read_state()
        state["routes"] = build_default_routes(number=68, head_sha=old_68_head)
        self.write_state(state)

        ev_file = self._setup_evidence_file(number=68, head_sha=old_68_head)
        r = self.run_queue("inspect", "68", "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("Old unreconstructed #68/#69 head is blocked", data.get("reason", ""))

        r_merge = self.run_queue(
            "merge", "68",
            "--expected-head", old_68_head,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r_merge.returncode, 2)
        self.assert_no_merge_attempted()

    def test_historical_exclusion_pr68_reconstructed_without_evidence(self):
        new_68_head = "c026349239ca287422dfec095c9ec3873f63b215"
        state = self.read_state()
        state["routes"] = build_default_routes(number=68, head_sha=new_68_head)
        self.write_state(state)

        # Missing rebuilt_candidate and rebuild_summary
        ev_file = self._setup_evidence_file(number=68, head_sha=new_68_head)
        r = self.run_queue("inspect", "68", "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("#68/#69 require explicit pinned independently reviewed rebuilt candidate evidence", data.get("reason", ""))

    def test_historical_exclusion_pr68_reconstructed_with_evidence(self):
        new_68_head = "c026349239ca287422dfec095c9ec3873f63b215"
        state = self.read_state()
        state["routes"] = build_default_routes(number=68, head_sha=new_68_head)
        self.write_state(state)

        evidence_data = self.build_evidence(number=68, head_sha=new_68_head)
        evidence_data["rebuilt_candidate"] = True
        evidence_data["rebuild_summary"] = "Clean rebuild on top of main"
        ev_file = self.test_dir / "evidence68.json"
        ev_file.write_text(json.dumps(evidence_data, indent=2))

        r = self.run_queue("inspect", "68", "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "ready")

    def test_bot_clean_review_accepted(self):
        bot_comment = {
            "id": "comment:7777",
            "kind": "comment",
            "body": f"Didn't find any major issues.\n**Reviewed commit:** `{DEFAULT_HEAD_SHA[:12]}`",
            "author": "chatgpt-codex-connector[bot]",
            "created_at": "2026-09-11T12:00:00Z",
            "updated_at": "2026-09-11T12:00:00Z"
        }
        bot_comment["fingerprint"] = fingerprint(bot_comment)
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/issues/{DEFAULT_PR_NUMBER}/comments?per_page=100"],
            [[{
                "id": 7777,
                "body": f"Didn't find any major issues.\n**Reviewed commit:** `{DEFAULT_HEAD_SHA[:12]}`",
                "user": {"login": "chatgpt-codex-connector[bot]"},
                "created_at": "2026-09-11T12:00:00Z",
                "updated_at": "2026-09-11T12:00:00Z"
            }]],
            match="prefix"
        )
        # Evidence has no human reviewer
        ev_file = self._setup_evidence_file(
            discussions=[bot_comment],
            reviewer="",
            reviewed_at="",
            summary="",
            verdict=""
        )
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "ready")

    def test_bot_clean_review_wrong_sha_rejected(self):
        wrong_sha = "999999999999"
        bot_comment = {
            "id": "comment:7777",
            "kind": "comment",
            "body": f"Didn't find any major issues.\n**Reviewed commit:** `{wrong_sha}`",
            "author": "chatgpt-codex-connector[bot]",
            "created_at": "2026-09-11T12:00:00Z",
            "updated_at": "2026-09-11T12:00:00Z"
        }
        bot_comment["fingerprint"] = fingerprint(bot_comment)
        self.set_route(
            ["api", f"repos/{DEFAULT_REPO}/issues/{DEFAULT_PR_NUMBER}/comments?per_page=100"],
            [[{
                "id": 7777,
                "body": f"Didn't find any major issues.\n**Reviewed commit:** `{wrong_sha}`",
                "user": {"login": "chatgpt-codex-connector[bot]"},
                "created_at": "2026-09-11T12:00:00Z",
                "updated_at": "2026-09-11T12:00:00Z"
            }]],
            match="prefix"
        )
        ev_file = self._setup_evidence_file(
            discussions=[bot_comment],
            reviewer="",
            reviewed_at="",
            summary="",
            verdict=""
        )
        r = self.run_queue("inspect", str(DEFAULT_PR_NUMBER), "--evidence", str(ev_file))
        data = json.loads(r.stdout)
        self.assertEqual(data.get("decision"), "blocked")
        self.assertIn("No independent clean review or bot clean review", data.get("reason", ""))

    def test_mutation_requires_full_40_hex_sha(self):
        ev_file = self._setup_evidence_file()
        short_sha = "c026349"
        r = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", short_sha,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn("Mutations require full --expected-head and --expected-base SHA", r.stderr)
        self.assert_no_merge_attempted()

    def test_merge_did_not_complete_fails_closed(self):
        ev_file = self._setup_evidence_file()
        state = self.read_state()
        state["auto_merge"] = False
        self.write_state(state)

        r = self.run_queue(
            "merge", str(DEFAULT_PR_NUMBER),
            "--expected-head", DEFAULT_HEAD_SHA,
            "--expected-base", DEFAULT_BASE_SHA,
            "--evidence", str(ev_file)
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn("Merge did not complete", r.stderr)
