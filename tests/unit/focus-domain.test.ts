import assert from "node:assert/strict";
import test from "node:test";
import { elapsedSeconds, transition, suggestedBreakMinutes, focusErrors, type SessionState } from "../../src/modules/focus/domain/session";
import { AppError } from "../../src/shared/kernel/errors";

const now = new Date("2026-09-04T12:00:00-05:00");
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const session: SessionState = {
  id: "session", kind: "FOCUS", status: "RUNNING", activeKey: 1,
  startedAt: now, pausedAt: null, completedAt: null, accumulatedPauseSeconds: 0,
  plannedMinutes: 25, actualMinutes: 0, needsEnrichment: false,
  taskId: null, projectId: null, task: null, label: "Focus"
};

test("focus transition is pure and accounts for repeated pauses and a paused finish", () => {
  const original = structuredClone(session);
  const paused = transition(session, "pause", at(90));
  assert.deepEqual(session, original);
  assert.equal(paused.evidence, null);
  assert.equal(elapsedSeconds(paused.state, at(500)), 90);
  const resumed = transition(paused.state, "resume", at(210));
  const pausedAgain = transition(resumed.state, "pause", at(300));
  const resumedAgain = transition(pausedAgain.state, "resume", at(360));
  const finalPause = transition(resumedAgain.state, "pause", at(420));
  const completed = transition(finalPause.state, "complete", at(1000));
  assert.equal(completed.state.actualMinutes, 4);
  assert.equal(completed.state.accumulatedPauseSeconds, 180);
  assert.equal(completed.evidence?.actualMinutes, 4);
  assert.equal(completed.state.activeKey, null);
  assert.deepEqual(completed.state.completedAt, at(1000));
  assert.equal(transition(completed.state, "complete", at(2000)).evidence, null);
});

test("focus evidence requires one whole minute, caps at plan, and excludes Break and cancel", () => {
  assert.equal(elapsedSeconds(session, at(-10)), 0);
  assert.equal(transition(session, "complete", at(59)).evidence, null);
  assert.equal(transition(session, "complete", at(60)).evidence?.actualMinutes, 1);
  assert.equal(transition(session, "complete", at(3600)).evidence?.actualMinutes, 25);
  const canceled = transition(session, "cancel", at(600));
  assert.equal(canceled.state.status, "CANCELED");
  assert.equal(canceled.evidence, null);
  const rest = transition({ ...session, kind: "BREAK" }, "complete", at(600));
  assert.equal(rest.state.actualMinutes, 10);
  assert.equal(rest.state.needsEnrichment, false);
  assert.equal(rest.evidence, null);
});

test("invalid focus transitions retain their fieldless conflict catalogs", () => {
  const cases = [
    [{ ...session, status: "PAUSED" }, "pause", focusErrors.onlyARunningTimerCanBePaused],
    [session, "resume", focusErrors.onlyAPausedTimerCanBeResumed],
    [{ ...session, status: "CANCELED" }, "complete", focusErrors.thisTimerIsNoLongerActive],
    [{ ...session, status: "COMPLETED" }, "cancel", focusErrors.thisTimerIsNoLongerActive],
    [session, "restart", focusErrors.unknownTimerAction]
  ] as const;
  for (const [state, action, spec] of cases) {
    assert.throws(() => transition(state, action, at(60)), error => {
      assert.ok(error instanceof AppError);
      assert.deepEqual(error.spec, spec);
      return true;
    });
  }
  assert.deepEqual([1, 10, 20, 25, 50, 240].map(suggestedBreakMinutes), [2, 2, 4, 5, 10, 10]);
});
