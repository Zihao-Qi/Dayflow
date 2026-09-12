import difflib
import os
import pathlib
import tempfile
import unittest
from common import QUEUE_PATH, GATEMERGE_PATH
from test_queue import TestQueue
from test_gatemerge import TestGateMerge

PROOF_DIR = pathlib.Path(os.environ.get("MERGE_GATE_PROOF_DIR", tempfile.gettempdir())) / "merge-gate-proof-mutants"

class TestMutants(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PROOF_DIR.mkdir(parents=True, exist_ok=True)
        cls.orig_queue = QUEUE_PATH.read_text()
        cls.orig_gatemerge = GATEMERGE_PATH.read_text()

    def _write_proof(self, name, orig_text, mutant_text, failure_msg):
        diff = "".join(difflib.unified_diff(
            orig_text.splitlines(keepends=True),
            mutant_text.splitlines(keepends=True),
            fromfile=f"a/{name}",
            tofile=f"b/{name}"
        ))
        (PROOF_DIR / f"{name}.diff").write_text(diff)
        (PROOF_DIR / f"{name}.log").write_text(failure_msg)

    def _run_queue_test(self, test_name, mutated_queue_text):
        with tempfile.TemporaryDirectory() as tmpdir:
            mutant_path = pathlib.Path(tmpdir) / "queue.py"
            mutant_path.write_text(mutated_queue_text)
            mutant_path.chmod(0o755)

            suite = unittest.TestSuite()
            test_instance = TestQueue(test_name)
            orig_run_queue = test_instance.run_queue
            test_instance.run_queue = lambda *args, **kwargs: orig_run_queue(*args, queue_bin=mutant_path, **kwargs)
            suite.addTest(test_instance)

            result = unittest.TestResult()
            suite.run(result)
            return result

    def _run_gatemerge_test(self, test_name, mutated_gatemerge_text=None, mutated_queue_text=None):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = pathlib.Path(tmpdir)
            gm_path = tmp_path / "gatemerge.py"
            q_path = tmp_path / "queue.py"

            gm_path.write_text(mutated_gatemerge_text if mutated_gatemerge_text else self.orig_gatemerge)
            q_path.write_text(mutated_queue_text if mutated_queue_text else self.orig_queue)
            gm_path.chmod(0o755)
            q_path.chmod(0o755)

            suite = unittest.TestSuite()
            test_instance = TestGateMerge(test_name)
            orig_run_gm = test_instance.run_gatemerge
            test_instance.run_gatemerge = lambda *args, **kwargs: orig_run_gm(*args, gatemerge_bin=gm_path, **kwargs)
            suite.addTest(test_instance)

            result = unittest.TestResult()
            suite.run(result)
            return result

    def test_mutant_1_behind_main_bypass(self):
        target = "if s['behind_by']!=0: raise Blocked('Head does not contain current main')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed behind_by")
        res = self._run_queue_test("test_behind_main_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 1 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_1_behind_main", self.orig_queue, mutated, err)

    def test_mutant_2_strict_rule_bypass(self):
        target = "if not s['strict'] or not any(r['context']=='Reliability gates' for r in s['required_checks']): raise Blocked('Expected strict server Reliability gates rule unavailable')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed strict rule")
        res = self._run_queue_test("test_absent_strict_rule_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 2 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_2_strict_rule", self.orig_queue, mutated, err)

    def test_mutant_3_check_pending_failed_bypass(self):
        target = "if not live or any(c['status']!='completed' or c['conclusion']!='success' for c in live): raise Blocked('Required check pending/failed: '+r['context'])"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed pending/failed")
        res = self._run_queue_test("test_failed_required_check", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 3 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_3_check_pending_failed", self.orig_queue, mutated, err)

    def test_mutant_4_wrong_head_app_bypass(self):
        target = "matching=[c for c in s['checks'] if c['name']==r['context'] and c['head_sha']==s['head_sha'] and (r.get('integration_id') is None or c['app_id']==r['integration_id'])]"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "matching=[c for c in s['checks'] if c['name']==r['context']]")
        res = self._run_queue_test("test_wrong_head_required_check", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 4 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_4_wrong_head_app", self.orig_queue, mutated, err)

    def test_mutant_5_cancelled_supersede_bypass(self):
        target = "live=[c for c in matching if not (c['conclusion']=='cancelled' and best is not None and c['id']<best)]"
        self.assertIn(target, self.orig_queue)
        # Claude's break: unconditionally drops any cancelled run, ignoring ordering vs best
        mutated = self.orig_queue.replace(target, "live=[c for c in matching if c['conclusion']!='cancelled']")
        res = self._run_queue_test("test_later_cancelled_check_after_earlier_success_blocked", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 5 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_5_cancelled_supersede", self.orig_queue, mutated, err)

    def test_mutant_6_stale_evidence_bypass(self):
        target = "if evidence.get('head_sha')!=s['head_sha'] or evidence.get('base_sha')!=s['base_sha'] or evidence.get('number')!=s['number']: raise Blocked('Review/triage evidence has stale PR/head/base')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed stale evidence")
        res = self._run_queue_test("test_stale_head_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 6 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_6_stale_evidence", self.orig_queue, mutated, err)

    def test_mutant_7_discussion_fingerprint_bypass(self):
        target = "if any(known.get(k)!=v for k,v in observed.items()): raise Blocked('New or edited untriaged discussion/review activity')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed discussion fingerprint")
        res = self._run_queue_test("test_new_or_edited_discussion_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 7 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_7_discussion_fingerprint", self.orig_queue, mutated, err)

    def test_mutant_8_untriaged_finding_bypass(self):
        target = "if t.get('fingerprint')!=d['fingerprint'] or t.get('disposition') not in ('fixed','obsolete','not-actionable') or not t.get('reason','').strip(): raise Blocked('Untriaged finding '+d['id'])"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed untriaged finding")
        res = self._run_queue_test("test_unresolved_untriaged_finding_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 8 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_8_untriaged_finding", self.orig_queue, mutated, err)

    def test_mutant_9_review_findings_bypass(self):
        target = "if evidence.get('findings'): raise Blocked('Independent review has findings')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed review findings")
        res = self._run_queue_test("test_nonempty_review_findings_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 9 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_9_review_findings", self.orig_queue, mutated, err)

    def test_mutant_10_pre_merge_drift_bypass(self):
        target = """    second=snapshot(number); pin(second,expected_head,expected_base)
    if gate(second,evidence)=='skip-merged': return {'decision':'skip-merged','number':number}
    main=api(f'repos/{REPO}/git/ref/heads/main')['object']['sha']; p=api(f'repos/{REPO}/pulls/{number}')
    if main!=expected_base or p['head']['sha']!=expected_head or p['base']['ref']!='main' or p['draft'] or p['state']!='open': raise Blocked('PR/main changed immediately before merge')"""
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "    pass # bypassed pre-merge drift re-verification")
        res = self._run_queue_test("test_pre_merge_drift_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 10 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_10_pre_merge_drift", self.orig_queue, mutated, err)

    def test_mutant_11_historical_exclusions_bypass(self):
        target = "if s['number']==70: raise Blocked('#70 is permanently excluded from this migration queue')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed pr70 exclusion")
        res = self._run_queue_test("test_historical_exclusion_pr70", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 11 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_11_historical_exclusions", self.orig_queue, mutated, err)

    def test_mutant_12_gatemerge_dry_run_bypass(self):
        target = 'if gated["decision"] != "ready" or a.dry_run:\n        sys.exit(0 if a.dry_run else 3)'
        self.assertIn(target, self.orig_gatemerge)
        mutated = self.orig_gatemerge.replace(target, 'if gated["decision"] != "ready":\n        sys.exit(3) # ignores dry_run')
        res = self._run_gatemerge_test("test_dry_run_ready_never_merges", mutated_gatemerge_text=mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 12 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_12_gatemerge_dry_run", self.orig_gatemerge, mutated, err)

    def test_mutant_13_gatemerge_untriaged_bypass(self):
        target = 'if untriaged:\n        print("REFUSING: findings need explicit --triage:", untriaged); sys.exit(2)'
        self.assertIn(target, self.orig_gatemerge)
        mutated = self.orig_gatemerge.replace(target, 'pass # bypassed untriaged refusal')
        res = self._run_gatemerge_test("test_untriaged_findings_refusal_exits_two", mutated_gatemerge_text=mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 13 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_13_gatemerge_untriaged", self.orig_gatemerge, mutated, err)

    def test_mutant_14_target_main_bypass(self):
        target = "if s['target']!='main': raise Blocked('PR target must be main')"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed target main")
        res = self._run_queue_test("test_non_main_target_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 14 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_14_target_main", self.orig_queue, mutated, err)

    def test_mutant_15_mergeable_clean_bypass(self):
        target = "if s['mergeable_state']!='clean': raise Blocked('GitHub merge state is not clean: '+str(s['mergeable_state']))"
        self.assertIn(target, self.orig_queue)
        mutated = self.orig_queue.replace(target, "pass # bypassed mergeable clean")
        res = self._run_queue_test("test_dirty_mergeable_state_refusal", mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 15 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_15_mergeable_clean", self.orig_queue, mutated, err)

    def test_mutant_16_retained_live_snapshot_bypass(self):
        target = 's = run_to(snap, ["inspect", str(a.number)], "inspect")'
        self.assertIn(target, self.orig_gatemerge)
        old_form = """r = run(["inspect", str(a.number), "--output", str(snap)])
    if not snap.exists():
        print("inspect failed:", r.stdout, r.stderr); sys.exit(1)
    s = json.loads(snap.read_text())"""
        mutated = self.orig_gatemerge.replace(target, old_form)
        res = self._run_gatemerge_test("test_failing_inspect_with_retained_live_snapshot", mutated_gatemerge_text=mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 16 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_16_retained_live_snapshot", self.orig_gatemerge, mutated, err)

    def test_mutant_17_retained_gated_inspect_bypass(self):
        target = """gated = run_to(state / f"pr{a.number}-gated.json",
                   ["inspect", str(a.number), "--evidence", str(evp)],
                   "gated inspect")"""
        self.assertIn(target, self.orig_gatemerge)
        old_form = """g = run(["inspect", str(a.number), "--evidence", str(evp),
             "--output", str(state / f"pr{a.number}-gated.json")])
    gated = json.loads((state / f"pr{a.number}-gated.json").read_text())"""
        mutated = self.orig_gatemerge.replace(target, old_form)
        res = self._run_gatemerge_test("test_failing_gated_inspect_with_retained_ready_gated_json", mutated_gatemerge_text=mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 17 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_17_retained_gated_inspect", self.orig_gatemerge, mutated, err)

    def test_mutant_18_retained_merge_json_bypass(self):
        target = """run_to(merge_path, ["merge", str(a.number), "--expected-head", s["head_sha"],
                        "--expected-base", s["base_sha"], "--evidence", str(evp)],
           "merge")"""
        self.assertIn(target, self.orig_gatemerge)
        old_form = """m = run(["merge", str(a.number), "--expected-head", s["head_sha"],
             "--expected-base", s["base_sha"], "--evidence", str(evp),
             "--output", str(merge_path)])"""
        mutated = self.orig_gatemerge.replace(target, old_form)
        res = self._run_gatemerge_test("test_failing_merge_with_retained_merge_json", mutated_gatemerge_text=mutated)
        self.assertFalse(res.wasSuccessful(), "Test passed against mutant 18 (should have failed)")
        err = res.failures[0][1] if res.failures else res.errors[0][1]
        self._write_proof("mutant_18_retained_merge_json", self.orig_gatemerge, mutated, err)
