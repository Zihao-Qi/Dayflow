import assert from "node:assert/strict";
import test from "node:test";
import type { HabitHistoryCheckIn, HabitHistoryPayload } from "../../src/modules/evidence/ui/history-api";
import {
  ACKNOWLEDGED_REFRESH_FAILURE,
  beginCheckInSave,
  beginHistoryLoad,
  beginReconcile,
  CLOSED_DAY_MESSAGE,
  createHistorySession,
  discardUnsentHistoryEdits,
  historyDayRefresh,
  historyForegroundRefresh,
  historyRecordKey,
  NEWER_READ_MESSAGE,
  RECONCILE_MISMATCH_MESSAGE,
  REFRESH_FAILURE_MESSAGE,
  SAVED_ANNOUNCEMENT,
  settleCheckInSave,
  settleHistoryLoad,
  settleReconcile,
  UNCONFIRMED_CHANGE_MESSAGE,
  updateHistoryDraft,
  type HabitHistoryDraft,
  type HistorySession
} from "../../src/modules/evidence/ui/habit-history-controller";

const habitId = "habit-1";
const today = "2026-09-26";
const earliest = "2026-09-19";

function history(checkIns: HabitHistoryCheckIn[] = [], bounds = { earliest, today }): HabitHistoryPayload {
  return {
    todayKey: bounds.today,
    earliestDate: bounds.earliest,
    latestDate: bounds.today,
    habits: [{
      id: habitId,
      name: "Reading",
      cadence: "DAILY",
      targetPerWeek: 7,
      status: "ACTIVE",
      sortOrder: 0,
      createdAt: "2026-09-01T12:00:00.000Z",
      archivedAt: null,
      createdDay: "2026-09-01",
      archivedDay: null
    }],
    checkIns
  };
}

function row(day: string, note: string, amount: number | null = 0): HabitHistoryCheckIn {
  return {
    id: `row-${day}`,
    habitId,
    date: `${day}T05:00:00.000Z`,
    day,
    done: true,
    amount,
    note
  };
}

function doneDraft(overrides: Partial<HabitHistoryDraft> = {}): HabitHistoryDraft {
  return {
    done: true,
    amount: "0",
    note: "kept",
    touchedAmount: true,
    touchedNote: true,
    ...overrides
  };
}

function withHistory(selectedDate = today, checkIns: HabitHistoryCheckIn[] = []): HistorySession {
  return { ...createHistorySession(selectedDate), history: history(checkIns) };
}

test("a save started after a history read keeps that check-in when the read arrives", () => {
  let session = withHistory();
  const load = beginHistoryLoad(session);
  session = load.session;
  const save = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft(),
    createId: () => "mutation-1"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  assert.equal(save.body.date, today);
  assert.equal(save.body.amount, 0);
  assert.equal(save.session.pending.get(historyRecordKey(habitId, today))?.isSaving, true);
  session = save.session;
  const published = settleCheckInSave(session, {
    habitId,
    date: today,
    mutationId: save.mutationId,
    startedAt: save.startedAt,
    outcome: { type: "success", checkIn: row(today, "kept") }
  });
  session = published.session;
  assert.equal(published.announcement, SAVED_ANNOUNCEMENT);
  const stale = settleHistoryLoad(session, load.generation, load.startedAt, {
    ok: true,
    data: history([])
  });
  const kept = stale.session.history?.checkIns.find((item) => item.day === today);
  assert.equal(kept?.note, "kept", "stale history read keeps the confirmed check-in");
  assert.equal(kept?.amount, 0, "stale history read keeps amount zero");
});

test("a receipt that arrives after a newer history read does not replace that read", () => {
  let session = withHistory(today, [row(today, "server", 1)]);
  const save = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft({ note: "attempt" }),
    createId: () => "mutation-replay"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  session = save.session;
  const load = beginHistoryLoad(session);
  session = load.session;
  session = settleHistoryLoad(session, load.generation, load.startedAt, {
    ok: true,
    data: history([row(today, "server", 1)])
  }).session;
  const late = settleCheckInSave(session, {
    habitId,
    date: today,
    mutationId: save.mutationId,
    startedAt: save.startedAt,
    outcome: { type: "success", checkIn: row(today, "attempt") }
  });
  assert.equal(
    late.session.history?.checkIns.find((item) => item.day === today)?.note,
    "server",
    "late receipt does not replace a newer history read"
  );
  assert.equal(late.session.pending.get(historyRecordKey(habitId, today))?.isUncertain, true);
  assert.equal(late.session.pending.get(historyRecordKey(habitId, today))?.mutationId, "mutation-replay");
  assert.equal(late.result.ok, false);
  assert.equal(late.result.error, NEWER_READ_MESSAGE);
});

test("a validation rejection does not erase an earlier uncertain attempt", () => {
  let session = withHistory();
  const first = beginCheckInSave(session, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-old"
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  session = settleCheckInSave(first.session, {
    habitId,
    date: earliest,
    mutationId: first.mutationId,
    startedAt: first.startedAt,
    outcome: { type: "failure", message: "network" }
  }).session;
  const retry = beginCheckInSave(session, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-new"
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.mutationId, "mutation-old", "uncertain attempt keeps its mutation id");
  session = settleCheckInSave(retry.session, {
    habitId,
    date: earliest,
    mutationId: retry.mutationId,
    startedAt: retry.startedAt,
    outcome: { type: "failure", status: 400, message: "closed", field: "date" }
  }).session;
  const pending = session.pending.get(historyRecordKey(habitId, earliest));
  assert.equal(pending?.isUncertain, true, "expired retry stays uncertain");
  assert.equal(pending?.mutationId, "mutation-old");
  assert.equal(pending?.fingerprint.includes(earliest), true, "saved payload keeps its original date");
});

test("a changed draft cannot replace an uncertain mutation", () => {
  let session = withHistory();
  const first = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft(),
    createId: () => "mutation-old"
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  session = settleCheckInSave(first.session, {
    habitId,
    date: today,
    mutationId: first.mutationId,
    startedAt: first.startedAt,
    outcome: { type: "failure", message: "network" }
  }).session;
  session = {
    ...session,
    drafts: new Map([[historyRecordKey(habitId, today), doneDraft()]])
  };
  const changed = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft({ done: false }),
    createId: () => "mutation-new"
  });
  assert.equal(changed.ok, false, "uncertain attempt keeps its mutation id");
  if (changed.ok) return;
  assert.equal(changed.error, UNCONFIRMED_CHANGE_MESSAGE);
  assert.equal(changed.session.pending.get(historyRecordKey(habitId, today))?.mutationId, "mutation-old");
  assert.equal(updateHistoryDraft(changed.session, habitId, today, { note: "other" }).drafts.get(historyRecordKey(habitId, today))?.note, "kept");
});

test("null or different reconciliation evidence keeps the uncertain attempt", () => {
  let session = withHistory();
  const key = historyRecordKey(habitId, earliest);
  session = {
    ...session,
    drafts: new Map([[key, doneDraft()]]),
    editingHabitId: habitId,
    selectedDate: "2026-09-20"
  };
  const save = beginCheckInSave(session, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-old"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  session = settleCheckInSave(save.session, {
    habitId,
    date: earliest,
    mutationId: save.mutationId,
    startedAt: save.startedAt,
    outcome: { type: "failure", message: "network" }
  }).session;
  const started = beginReconcile(session);
  const missing = settleReconcile(started.session, {
    habitId,
    date: earliest,
    startedAt: started.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: "2026-09-27",
        earliestDate: "2026-09-20",
        latestDate: "2026-09-27",
        habitId,
        date: earliest,
        checkIn: null
      }
    }
  });
  assert.equal(missing.session.pending.get(key)?.mutationId, "mutation-old", "null reconciliation keeps the uncertain attempt");
  assert.equal(missing.session.drafts.get(key)?.note, "kept");
  assert.equal(missing.session.selectedDate, "2026-09-20", "expired selection stays on its original date");
  assert.equal(missing.shellRefresh, false);
  assert.equal(missing.session.history?.todayKey, "2026-09-27");
  const different = settleReconcile(beginReconcile(missing.session).session, {
    habitId,
    date: earliest,
    startedAt: beginReconcile(missing.session).startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: "2026-09-27",
        earliestDate: "2026-09-20",
        latestDate: "2026-09-27",
        habitId,
        date: earliest,
        checkIn: row(earliest, "other evidence", 4)
      }
    }
  });
  assert.equal(different.session.pending.get(key)?.isUncertain, true);
  assert.equal(different.session.errors.get(key)?.message, RECONCILE_MISMATCH_MESSAGE);
  assert.equal(different.session.history?.checkIns.find((item) => item.day === earliest)?.note, "other evidence");
});

test("a history refresh that moves the window does not retarget the selected date", () => {
  let session = withHistory(earliest);
  const load = beginHistoryLoad(session);
  const settled = settleHistoryLoad(load.session, load.generation, load.startedAt, {
    ok: true,
    data: history([], { earliest: "2026-09-20", today: "2026-09-27" })
  });
  assert.equal(settled.session.selectedDate, earliest, "expired selection stays on its original date");
});

test("each history load settles only its own loading and error", () => {
  let session = createHistorySession(today);
  const first = beginHistoryLoad(session);
  const second = beginHistoryLoad(first.session);
  const superseded = settleHistoryLoad(second.session, first.generation, first.startedAt, {
    ok: false,
    message: "first failed"
  });
  assert.equal(superseded.session.loading, true, "superseded load does not clear loading");
  assert.equal(superseded.applied, false);
  assert.equal(superseded.session.loadError, null);
  const failed = settleHistoryLoad(superseded.session, second.generation, second.startedAt, {
    ok: false,
    message: "still down"
  });
  assert.equal(failed.session.loading, false);
  assert.equal(failed.session.loadError, "still down", "failed load keeps loadError");
  assert.equal(failed.session.refreshError, null);
  const reload = beginHistoryLoad(failed.session);
  const loaded = settleHistoryLoad(reload.session, reload.generation, reload.startedAt, {
    ok: true,
    data: history([row(today, "kept")])
  });
  const refresh = beginHistoryLoad(loaded.session);
  const refreshFailed = settleHistoryLoad(refresh.session, refresh.generation, refresh.startedAt, {
    ok: false,
    message: "Habit history could not be loaded."
  });
  assert.equal(refreshFailed.session.refreshError, REFRESH_FAILURE_MESSAGE);
  assert.equal(refreshFailed.session.loadError, null);
  assert.equal(
    refreshFailed.session.history?.checkIns[0]?.note,
    "kept",
    "refresh failure keeps the confirmed check-in"
  );
});

test("a confirmed save closes only the editor for that same date", () => {
  let session = withHistory("2026-09-20");
  session = { ...session, editingHabitId: habitId };
  const save = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft(),
    createId: () => "mutation-1"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  const settled = settleCheckInSave(save.session, {
    habitId,
    date: today,
    mutationId: save.mutationId,
    startedAt: save.startedAt,
    outcome: { type: "success", checkIn: row(today, "kept") }
  });
  assert.equal(settled.session.editingHabitId, habitId, "other-date editor stays open");
});

test("discard and a closed day keep the uncertain payload", () => {
  let session = withHistory(earliest, []);
  const save = beginCheckInSave(session, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-old"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  session = settleCheckInSave(save.session, {
    habitId,
    date: earliest,
    mutationId: save.mutationId,
    startedAt: save.startedAt,
    outcome: { type: "failure", message: "network" }
  }).session;
  session = {
    ...session,
    history: history([], { earliest: "2026-09-20", today: "2026-09-27" }),
    drafts: new Map([[historyRecordKey(habitId, earliest), doneDraft()]])
  };
  const discarded = discardUnsentHistoryEdits(session);
  assert.equal(discarded.drafts.get(historyRecordKey(habitId, earliest))?.note, "kept", "discard keeps the uncertain payload");
  assert.equal(discarded.pending.get(historyRecordKey(habitId, earliest))?.mutationId, "mutation-old");
  const closed = beginCheckInSave(discarded, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-new"
  });
  assert.equal(closed.ok, false);
  if (closed.ok) return;
  assert.equal(closed.error, CLOSED_DAY_MESSAGE);
  assert.equal(closed.session.pending.get(historyRecordKey(habitId, earliest))?.mutationId, "mutation-old");
  assert.equal(closed.session.pending.get(historyRecordKey(habitId, earliest))?.isUncertain, true);
});

test("one in-flight save blocks the surface, and foreground refresh follows open visibility", () => {
  let session = withHistory();
  const save = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft(),
    createId: () => "mutation-1"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  const other = beginCheckInSave(save.session, {
    habitId,
    date: earliest,
    draft: doneDraft(),
    createId: () => "mutation-2"
  });
  assert.equal(other.ok, false, "one save occupies the surface");
  assert.equal(other.session.pending.size, 1);
  assert.equal(historyForegroundRefresh(true, "visible"), true, "foreground refresh runs while the dialog is visible");
  assert.equal(historyForegroundRefresh(false, "visible"), false);
  assert.equal(historyForegroundRefresh(true, "hidden"), false);
  assert.equal(historyDayRefresh("2026-09-26", "2026-09-27"), true);
  assert.equal(historyDayRefresh(undefined, "2026-09-27"), false);
});

test("a same-id retry does not project its original receipt over a read that preceded the retry", () => {
  let session = withHistory(today, [row(today, "initial")]);
  const first = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft({ note: "original" }),
    createId: () => "m"
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  session = settleCheckInSave(first.session, {
    habitId,
    date: today,
    mutationId: first.mutationId,
    startedAt: first.startedAt,
    outcome: { type: "failure", message: "lost" }
  }).session;
  const load = beginHistoryLoad(session);
  session = settleHistoryLoad(load.session, load.generation, load.startedAt, {
    ok: true,
    data: history([row(today, "newer current fact")])
  }).session;
  const retry = beginCheckInSave(session, {
    habitId,
    date: today,
    draft: doneDraft({ note: "original" }),
    createId: () => "wrong-new-id"
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.mutationId, "m");
  const replay = settleCheckInSave(retry.session, {
    habitId,
    date: today,
    mutationId: retry.mutationId,
    startedAt: retry.startedAt,
    outcome: { type: "success", checkIn: row(today, "original") }
  });
  assert.equal(replay.session.history?.checkIns[0]?.note, "newer current fact", "retry receipt does not replace read predating retry");
  assert.equal(replay.shellRefresh, true, "shell confirmation is separate from the on-screen record");
  assert.notEqual(replay.announcement, "Saved check-in.");
  const refresh = beginHistoryLoad(replay.session);
  const failed = settleHistoryLoad(refresh.session, refresh.generation, refresh.startedAt, {
    ok: false,
    message: "down"
  });
  assert.equal(failed.session.history?.checkIns[0]?.note, "newer current fact");
  assert.equal(failed.session.refreshError, ACKNOWLEDGED_REFRESH_FAILURE, "acknowledged save stays unrefreshed without another receipt");
});

test("an older exact-date read cannot replace a newer one, and a history list cannot either", () => {
  let session = withHistory(today, [row(today, "initial")]);
  const older = beginReconcile(session);
  const newer = beginReconcile(older.session);
  session = settleReconcile(newer.session, {
    habitId,
    date: today,
    startedAt: newer.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: today,
        earliestDate: earliest,
        latestDate: today,
        habitId,
        date: today,
        checkIn: row(today, "newer")
      }
    }
  }).session;
  session = settleReconcile(session, {
    habitId,
    date: today,
    startedAt: older.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: today,
        earliestDate: earliest,
        latestDate: today,
        habitId,
        date: today,
        checkIn: row(today, "older")
      }
    }
  }).session;
  assert.equal(session.history?.checkIns[0]?.note, "newer", "older reconcile cannot replace newer reconcile");
  const earlyList = beginHistoryLoad(withHistory(today, [row(today, "initial")]));
  const exact = beginReconcile(earlyList.session);
  const exactSession = settleReconcile(exact.session, {
    habitId,
    date: today,
    startedAt: exact.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: today,
        earliestDate: earliest,
        latestDate: today,
        habitId,
        date: today,
        checkIn: row(today, "exact")
      }
    }
  }).session;
  const lateList = settleHistoryLoad(exactSession, earlyList.generation, earlyList.startedAt, {
    ok: true,
    data: history([row(today, "list-old")])
  });
  assert.equal(
    lateList.session.history?.checkIns.find((item) => item.day === today)?.note,
    "exact",
    "history list started before an exact-date read cannot replace it"
  );
  const after = beginHistoryLoad(lateList.session);
  const replaced = settleHistoryLoad(after.session, after.generation, after.startedAt, {
    ok: true,
    data: history([row(today, "list-new")])
  });
  assert.equal(replaced.session.history?.checkIns[0]?.note, "list-new", "a later history list owns the row");
});

test("a reconcile that started before a save cannot unlock or resolve that save", () => {
  let session = withHistory(today, [row(today, "initial", 1)]);
  const read = beginReconcile(session);
  const save = beginCheckInSave(read.session, {
    habitId,
    date: today,
    draft: doneDraft(),
    createId: () => "m2"
  });
  assert.equal(save.ok, true);
  if (!save.ok) return;
  const key = historyRecordKey(habitId, today);
  const missing = settleReconcile(save.session, {
    habitId,
    date: today,
    startedAt: read.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: today,
        earliestDate: earliest,
        latestDate: today,
        habitId,
        date: today,
        checkIn: null
      }
    }
  });
  assert.equal(missing.session.pending.get(key)?.isSaving, true, "stale reconcile preserves in-flight save lock");
  assert.equal(missing.session.history?.checkIns[0]?.note, "initial", "stale reconcile does not clear the in-flight row");
  const matched = settleReconcile(save.session, {
    habitId,
    date: today,
    startedAt: read.startedAt,
    outcome: {
      ok: true,
      result: {
        todayKey: today,
        earliestDate: earliest,
        latestDate: today,
        habitId,
        date: today,
        checkIn: row(today, "kept")
      }
    }
  });
  assert.equal(matched.session.pending.get(key)?.mutationId, "m2", "stale matching reconcile does not resolve the in-flight save");
  assert.equal(matched.session.pending.get(key)?.isSaving, true);
  const failed = settleReconcile(save.session, {
    habitId,
    date: today,
    startedAt: read.startedAt,
    outcome: { ok: false, message: "read failed" }
  });
  assert.equal(failed.session.pending.get(key)?.isSaving, true, "stale reconcile failure preserves in-flight save lock");
  assert.equal(failed.session.errors.has(key), false);
});
