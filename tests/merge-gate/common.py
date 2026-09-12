import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
QUEUE_PATH = REPO_ROOT / "tools" / "merge-gate" / "queue.py"
GATEMERGE_PATH = REPO_ROOT / "tools" / "merge-gate" / "gatemerge.py"

DEFAULT_HEAD_SHA = "c026349239ca287422dfec095c9ec3873f63b215"
DEFAULT_BASE_SHA = "e9db471edf745e800a5bc775fff50c18a8c09a84"
DEFAULT_PR_NUMBER = 101
DEFAULT_REPO = "Zihao-Qi/Dayflow"
DEFAULT_REVIEW_AT = "2026-09-11T12:00:00Z"

def fingerprint(item):
    return hashlib.sha256(json.dumps(item, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def make_check_runs(head_sha, app_id=15368, status="completed", conclusion="success", check_id=1001, name="Reliability gates"):
    return [
        {
            "id": check_id,
            "name": name,
            "head_sha": head_sha,
            "app": {"id": app_id},
            "status": status,
            "conclusion": conclusion,
            "html_url": f"https://github.com/{DEFAULT_REPO}/actions/runs/{check_id}"
        }
    ]

def make_rules(strict=True, required_contexts=None):
    if required_contexts is None:
        required_contexts = [{"context": "Reliability gates", "integration_id": 15368}]
    return [
        {
            "type": "required_status_checks",
            "parameters": {
                "strict_required_status_checks_policy": strict,
                "required_status_checks": required_contexts
            }
        }
    ]

def build_default_routes(number=DEFAULT_PR_NUMBER, head_sha=DEFAULT_HEAD_SHA, base_sha=DEFAULT_BASE_SHA,
                         behind_by=0, mergeable_state="clean", check_runs=None, statuses=None,
                         threads=None, comments=None, reviews=None, rules=None):
    if check_runs is None:
        check_runs = make_check_runs(head_sha)
    if statuses is None:
        statuses = []
    if threads is None:
        threads = []
    if comments is None:
        comments = []
    if reviews is None:
        reviews = []
    if rules is None:
        rules = make_rules()

    routes = [
        # Pull request details
        {
            "match": "exact",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/pulls/{number}"],
            "response": {
                "number": number,
                "state": "open",
                "draft": False,
                "merged": False,
                "head": {"sha": head_sha},
                "base": {"ref": "main"},
                "mergeable_state": mergeable_state,
                "html_url": f"https://github.com/{DEFAULT_REPO}/pull/{number}"
            }
        },
        # Main branch ref
        {
            "match": "exact",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/git/ref/heads/main"],
            "response": {
                "object": {"sha": base_sha}
            }
        },
        # Compare
        {
            "match": "contains",
            "pattern": ["compare/"],
            "response": {
                "behind_by": behind_by,
                "status": "ahead" if behind_by == 0 else "diverged"
            }
        },
        # Rules
        {
            "match": "exact",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/rules/branches/main"],
            "response": rules
        },
        # Check runs
        {
            "match": "prefix",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/commits/{head_sha}/check-runs?per_page=100&filter=latest"],
            "response": [{"check_runs": check_runs}]
        },
        # Statuses
        {
            "match": "prefix",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/commits/{head_sha}/statuses?per_page=100"],
            "response": [statuses]
        },
        # GraphQL reviewThreads
        {
            "match": "graphql",
            "query_contains": "reviewThreads",
            "response": {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": threads,
                                "pageInfo": {
                                    "hasNextPage": False,
                                    "endCursor": None
                                }
                            }
                        }
                    }
                }
            }
        },
        # Issue comments
        {
            "match": "prefix",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/issues/{number}/comments?per_page=100"],
            "response": [comments]
        },
        # Reviews
        {
            "match": "prefix",
            "pattern": ["api", f"repos/{DEFAULT_REPO}/pulls/{number}/reviews?per_page=100"],
            "response": [reviews]
        }
    ]
    return routes

class MergeGateTestCase(unittest.TestCase):
    def setUp(self):
        self.test_dir = pathlib.Path(tempfile.mkdtemp(prefix="mg-test-"))
        self.bin_dir = self.test_dir / "bin"
        self.bin_dir.mkdir(parents=True, exist_ok=True)
        self.state_dir = self.test_dir / "state"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = self.test_dir / "fake_gh_state.json"

        # Create executable gh wrapper
        fake_gh_script = REPO_ROOT / "tests" / "merge-gate" / "fake_gh.py"
        gh_path = self.bin_dir / "gh"
        gh_path.write_text(f"""#!/bin/sh
exec "{sys.executable}" "{fake_gh_script}" "$@"
""")
        gh_path.chmod(0o755)

        self.initial_routes = build_default_routes()
        self.state = {
            "recorded_calls": [],
            "routes": self.initial_routes,
            "auto_merge": True,
            "merged": False,
            "merge_commit_sha": "d00d1e1edf745e800a5bc775fff50c18a8c09a84"
        }
        self.write_state(self.state)

        env = os.environ.copy()
        env["PATH"] = f"{self.bin_dir}:{env.get('PATH', '')}"
        env["DAYFLOW_MERGE_GATE_STATE"] = str(self.state_dir)
        env["FAKE_GH_STATE_FILE"] = str(self.state_file)
        self.env = env

        self.addCleanup(self._cleanup)

    def _cleanup(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def write_state(self, state):
        self.state_file.write_text(json.dumps(state, indent=2))

    def read_state(self):
        return json.loads(self.state_file.read_text())

    def get_recorded_calls(self):
        return self.read_state().get("recorded_calls", [])

    def assert_no_merge_attempted(self):
        recorded = self.get_recorded_calls()
        for call in recorded:
            if len(call) >= 2 and call[0] == "pr" and call[1] == "merge":
                self.fail(f"gh pr merge was executed when it should have been refused: {call}")

    def assert_merge_attempted(self, expected_head=None):
        recorded = self.get_recorded_calls()
        merge_calls = [c for c in recorded if len(c) >= 2 and c[0] == "pr" and c[1] == "merge"]
        self.assertTrue(len(merge_calls) > 0, "Expected gh pr merge to be executed, but it was not")
        if expected_head:
            self.assertIn("--match-head-commit", merge_calls[0])
            idx = merge_calls[0].index("--match-head-commit")
            self.assertEqual(merge_calls[0][idx + 1], expected_head)

    def set_route(self, pattern, response, exit_code=0, stderr="", match="exact", once=False):
        state = self.read_state()
        new_route = {
            "match": match,
            "pattern": pattern,
            "response": response,
            "exit_code": exit_code,
            "stderr": stderr,
            "once": once
        }
        state["routes"].insert(0, new_route)
        self.write_state(state)

    def run_queue(self, *args, check=False, queue_bin=QUEUE_PATH):
        r = subprocess.run(
            [sys.executable, str(queue_bin), *args],
            capture_output=True,
            text=True,
            env=self.env
        )
        if check and r.returncode != 0:
            raise RuntimeError(f"queue.py failed ({r.returncode}):\nStdout: {r.stdout}\nStderr: {r.stderr}")
        return r

    def run_gatemerge(self, *args, check=False, cwd=None, gatemerge_bin=GATEMERGE_PATH):
        r = subprocess.run(
            [sys.executable, str(gatemerge_bin), *args],
            capture_output=True,
            text=True,
            env=self.env,
            cwd=cwd
        )
        if check and r.returncode != 0:
            raise RuntimeError(f"gatemerge.py failed ({r.returncode}):\nStdout: {r.stdout}\nStderr: {r.stderr}")
        return r

    def build_evidence(self, number=DEFAULT_PR_NUMBER, head_sha=DEFAULT_HEAD_SHA, base_sha=DEFAULT_BASE_SHA,
                       discussions=None, triage=None, findings=None, verdict="clean",
                       reviewer="Codex", reviewed_at=DEFAULT_REVIEW_AT, summary="Test summary"):
        if discussions is None:
            discussions = []
        if triage is None:
            triage = []
        if findings is None:
            findings = []

        return {
            "number": number,
            "head_sha": head_sha,
            "base_sha": base_sha,
            "verdict": verdict,
            "reviewer": reviewer,
            "reviewed_at": reviewed_at,
            "summary": summary,
            "findings": findings,
            "discussion_fingerprints": {d["id"]: d["fingerprint"] for d in discussions},
            "triage": triage
        }
