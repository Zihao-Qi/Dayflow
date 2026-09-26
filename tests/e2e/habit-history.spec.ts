/**
 * End-to-End Acceptance Tests for Habit History & 8-day Backfill Dialog.
 *
 * Scope:
 * 1. REAL ENDPOINTS (Real SQLite via Next.js server):
 *    - Proof 1: TRUE post-archive lifecycle discovery and explicit false record with stored false/0/note across reload
 *    - Proof 2: Omitted vs explicit null request payload semantics and server persistence
 *    - Accessibility: persistent visible labels, verbatim label in name, focus restoration on Cancel/Save
 *    - Proof 5: Keyboard lifecycle: dirty draft escape warning, keep editing, discard focus restoration, and in-flight date navigation
 *
 * 2. LABELLED MOCKED SCENARIOS (Deterministic fault injection):
 *    - Global pending UI: in-flight save blocks concurrent saves and check status while preserving draft edits
 *    - Network failure triggers uncertain state, disables inputs, enables exact-date reconciliation with accessible name
 *    - Proof 3: Lost-response -> stale original receipt RETRY preserves newer displayed fact with acknowledged banner and GET-only refresh
 *    - Proof 4: Expired 400 after uncertainty retains check-status, disables writes, and names original date on exact-date GET
 *    - Saved-write / read-refresh-failure displays warning banner without falsifying write, enabling GET-only retry
 */

import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resetTestDatabase, testDatabasePath } from "./database";
import type { HabitHistoryPayload } from "../../src/modules/evidence/ui/history-api";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openToday(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /(tasks? left|Nothing scheduled yet|All done for today)$/
    })
  ).toBeVisible({ timeout: 30_000 });
}

async function createHabit(page: Page, name: string) {
  const created = await page.request.post("/api/habits", { data: { name } });
  expect(created.ok(), await created.text()).toBe(true);
  return created.json();
}

function seedLifecycleHabit(options: {
  id: string;
  name: string;
  createdDaysAgo: number;
  archivedDaysAgo: number;
}) {
  const database = new DatabaseSync(testDatabasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const createdAt = now - options.createdDaysAgo * dayMs;
    const archivedAt = now - options.archivedDaysAgo * dayMs;
    database.exec(`
      INSERT INTO "Habit"
      ("id", "name", "cadence", "targetPerWeek", "status", "sortOrder", "archivedAt", "createdAt", "updatedAt")
      VALUES
      ('${options.id}', '${options.name}', 'DAILY', 7, 'ARCHIVED', 0, ${archivedAt}, ${createdAt}, ${archivedAt});
    `);
    return { id: options.id, name: options.name, createdAt, archivedAt };
  } finally {
    database.close();
  }
}

test.describe("Habit History & Backfill (Real Routes)", () => {
  test("Proof 1: TRUE post-archive discovery and explicit false record with stored false/0/note across reload", async ({ page }) => {
    // 1. Seed lifecycle timestamps: created 25 days ago (before today-20), archived 10 days ago (today-10)
    const seeded = seedLifecycleHabit({
      id: "habit-archived-lifecycle",
      name: "Archived Habit Lifecycle",
      createdDaysAgo: 25,
      archivedDaysAgo: 10
    });

    // 2. Query history API to verify bounds and assert fixture inequality in test before UI actions
    const initRes = await page.request.get("/api/habits/history");
    expect(initRes.ok()).toBe(true);
    const initHistory: HabitHistoryPayload = await initRes.json();
    const seededInHistory = initHistory.habits.find((h) => h.id === seeded.id);
    expect(seededInHistory).toBeDefined();
    expect(seededInHistory!.archivedDay).not.toBeNull();
    expect(seededInHistory!.createdDay < seededInHistory!.archivedDay!).toBe(true);
    expect(seededInHistory!.archivedDay! < initHistory.earliestDate).toBe(true);

    const targetDay = initHistory.earliestDate; // today - 7, which is > archivedDay

    await openToday(page);

    // 3. "History" button is accessible in HabitsCard header even with 0 active habits
    const historyBtn = page.getByRole("button", { name: "History" });
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();

    // Active list is empty: "No habits found."
    await expect(dialog.getByText("No habits found.")).toBeVisible();

    // 4. Disclose archived habits without overlap or recent evidence
    const archivedToggle = dialog.getByLabel(/Show archived/);
    await expect(archivedToggle).toBeVisible();
    await archivedToggle.check();

    const archivedRow = dialog.locator(`[data-habit="${seeded.id}"]`);
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByText("Archived")).toBeVisible();

    // 5. Select earliest date in window (targetDay > archivedDay: true post-archive)
    const dateBar = dialog.getByRole("region", { name: "Select history date" });
    const dateButtons = dateBar.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);

    const oldestDateBtn = dateButtons.first();
    await oldestDateBtn.click();
    await expect(oldestDateBtn).toHaveAttribute("aria-pressed", "true");

    const recordArchivedBtn = archivedRow.getByRole("button", { name: /Record Archived Habit Lifecycle/ });
    await expect(recordArchivedBtn).toBeVisible();
    await recordArchivedBtn.click();

    const archivedEditor = archivedRow.locator(".habit-history-editor");
    await expect(archivedEditor).toBeVisible();

    // Select "Not done" (explicit false record) with Amount 0 and Note
    await archivedEditor.getByRole("button", { name: "Not done", exact: true }).click();
    await archivedEditor.getByLabel(/^Amount/).fill("0");
    await archivedEditor.getByLabel(/^Note/).fill("Post-archive miss recorded");

    const saveArchivedBtn = archivedEditor.getByRole("button", { name: "Save" });
    await saveArchivedBtn.click();

    await expect(archivedEditor).not.toBeVisible();
    await expect(archivedRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(archivedRow.getByText("Amount: 0")).toBeVisible();
    await expect(archivedRow.getByText("“Post-archive miss recorded”")).toBeVisible();

    // 6. Exact GET proves stored false, 0, and note on the real server
    const checkInRes = await page.request.get(`/api/habits/${seeded.id}/check-in?date=${targetDay}`);
    expect(checkInRes.ok()).toBe(true);
    const checkInJson = await checkInRes.json();
    expect(checkInJson.checkIn.done).toBe(false);
    expect(checkInJson.checkIn.amount).toBe(0);
    expect(checkInJson.checkIn.note).toBe("Post-archive miss recorded");
    expect(checkInJson.checkIn.day).toBe(targetDay);

    // 7. Close dialog and reload page to test persistence from real SQLite database
    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: /(tasks? left|Nothing scheduled yet|All done for today)$/
      })
    ).toBeVisible();

    // Reopen history dialog and check oldest day for the post-archive record
    await page.getByRole("button", { name: "History" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Show archived/).check();

    const reopenedDateButtons = dialog.locator("button.habit-history-date-btn");
    await reopenedDateButtons.first().click();

    const persistedArchivedRow = dialog.locator(`[data-habit="${seeded.id}"]`);
    await expect(persistedArchivedRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(persistedArchivedRow.getByText("Amount: 0")).toBeVisible();
    await expect(persistedArchivedRow.getByText("“Post-archive miss recorded”")).toBeVisible();
  });

  test("Proof 2: Omitted vs explicit null REQUEST semantics and server persistence", async ({ page }) => {
    const habit = await createHabit(page, "Hydration Tracking");

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator(`[data-habit="${habit.id}"]`);
    await expect(habitRow).toBeVisible();

    const historyRes = await page.request.get("/api/habits/history");
    expect(historyRes.ok()).toBe(true);
    const { todayKey } = await historyRes.json();

    const dateButtons = dialog.locator("button.habit-history-date-btn");
    const todayBtn = dateButtons.last();
    await todayBtn.click();

    // 1. Initial record with Amount: 8 and Note: "8 glasses"
    await habitRow.getByRole("button", { name: /Record Hydration Tracking/ }).click();
    const editor = habitRow.locator(".habit-history-editor");
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("8");
    await editor.getByLabel(/^Note/).fill("8 glasses");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).not.toBeVisible();

    await expect(habitRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(habitRow.getByText("Amount: 8")).toBeVisible();
    await expect(habitRow.getByText("“8 glasses”")).toBeVisible();

    // 2. Untouched-details Save: Edit without touching Amount or Note
    let untouchedPayload: any = null;
    const captureUntouched = (req: any) => {
      if (req.method() === "PUT" && req.url().includes(`/api/habits/${habit.id}/check-in`)) {
        untouchedPayload = req.postDataJSON();
      }
    };
    page.on("request", captureUntouched);

    await habitRow.getByRole("button", { name: /Edit Hydration Tracking/ }).click();
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).not.toBeVisible();

    page.off("request", captureUntouched);

    // Assert: Object.hasOwn(payload, 'amount'/'note') == false on untouched details
    expect(untouchedPayload).not.toBeNull();
    expect(Object.hasOwn(untouchedPayload, "amount")).toBe(false);
    expect(Object.hasOwn(untouchedPayload, "note")).toBe(false);

    // Observe server row unchanged after read/reload
    const getRes = await page.request.get(`/api/habits/${habit.id}/check-in?date=${todayKey}`);
    expect(getRes.ok()).toBe(true);
    const getJson = await getRes.json();
    expect(getJson.checkIn.amount).toBe(8);
    expect(getJson.checkIn.note).toBe("8 glasses");
    await expect(habitRow.getByText("Amount: 8")).toBeVisible();
    await expect(habitRow.getByText("“8 glasses”")).toBeVisible();

    // 3. Explicitly cleared inputs: Edit and clear Amount and Note
    let clearedPayload: any = null;
    const captureCleared = (req: any) => {
      if (req.method() === "PUT" && req.url().includes(`/api/habits/${habit.id}/check-in`)) {
        clearedPayload = req.postDataJSON();
      }
    };
    page.on("request", captureCleared);

    await habitRow.getByRole("button", { name: /Edit Hydration Tracking/ }).click();
    await expect(editor).toBeVisible();
    await editor.getByLabel(/^Amount/).fill("");
    await editor.getByLabel(/^Note/).fill("");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).not.toBeVisible();

    page.off("request", captureCleared);

    // Assert: both properties are present and null
    expect(clearedPayload).not.toBeNull();
    expect(Object.hasOwn(clearedPayload, "amount")).toBe(true);
    expect(clearedPayload.amount).toBeNull();
    expect(Object.hasOwn(clearedPayload, "note")).toBe(true);
    expect(clearedPayload.note).toBeNull();

    // GET / reload proves null in SQLite
    const clearedGetRes = await page.request.get(`/api/habits/${habit.id}/check-in?date=${todayKey}`);
    expect(clearedGetRes.ok()).toBe(true);
    const clearedGetJson = await clearedGetRes.json();
    expect(clearedGetJson.checkIn.amount).toBeNull();
    expect(clearedGetJson.checkIn.note).toBeNull();

    await page.reload();
    await page.getByRole("button", { name: "History" }).click();
    await expect(dialog).toBeVisible();
    const reloadedRow = dialog.locator(`[data-habit="${habit.id}"]`);
    await expect(reloadedRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(reloadedRow.getByText("Amount:")).not.toBeVisible();
  });

  test("Accessibility: persistent visible labels, verbatim label in name, and row focus restoration on Cancel and Save", async ({ page }) => {
    const habit = await createHabit(page, "Read Book");

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator(`[data-habit="${habit.id}"]`);

    // 1. Record button has accessible name containing visible "Record" verbatim
    const recordBtn = habitRow.getByRole("button", { name: /^Record Read Book/ });
    await expect(recordBtn).toBeVisible();
    await expect(recordBtn).toHaveText("Record");

    // Click Record to open editor
    await recordBtn.click();

    const editor = habitRow.locator(".habit-history-editor");
    await expect(editor).toBeVisible();

    // 2. Persistent visible labels exist for Amount and Note
    const amountLabel = editor.locator("label.habit-history-field-label", { hasText: "Amount" });
    await expect(amountLabel).toBeVisible();
    const amountInput = editor.getByLabel(/^Amount/);
    await expect(amountInput).toBeVisible();

    const noteLabel = editor.locator("label.habit-history-field-label", { hasText: "Note" });
    await expect(noteLabel).toBeVisible();
    const noteInput = editor.getByLabel(/^Note/);
    await expect(noteInput).toBeVisible();

    // 3. Focus restoration on Cancel:
    const cancelBtn = editor.getByRole("button", { name: "Cancel" });
    await cancelBtn.click();

    await expect(editor).not.toBeVisible();
    // Focus must explicitly restore to the row's Record button!
    await expect(recordBtn).toBeFocused();

    // 4. Focus restoration on Save:
    await recordBtn.click();
    await expect(editor).toBeVisible();

    await editor.getByRole("button", { name: "Done", exact: true }).click();
    const saveBtn = editor.getByRole("button", { name: "Save" });
    await saveBtn.click();

    await expect(editor).not.toBeVisible();

    // After saving, the button visible text becomes "Edit"
    const editBtn = habitRow.getByRole("button", { name: /^Edit Read Book/ });
    await expect(editBtn).toBeVisible();
    await expect(editBtn).toHaveText("Edit");

    // Focus must explicitly restore to the row's Edit button!
    await expect(editBtn).toBeFocused();
  });

  test("Proof 5: Keyboard lifecycle: dirty draft escape warning, keep editing, discard focus restoration, and in-flight date navigation", async ({ page }) => {
    const habit = await createHabit(page, "Keyboard Habit");

    await openToday(page);
    const historyBtn = page.getByRole("button", { name: "History" });
    await historyBtn.click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();

    const dateButtons = dialog.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);
    await expect(dialog.getByRole("button", { name: "Refresh habit history" })).toBeEnabled();

    // 1. Tab / Shift-Tab boundary trap: focus wraps at first and last elements
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstFocusable = dialog.locator(focusableSelector).first();
    const lastFocusable = dialog.locator(focusableSelector).last();

    await firstFocusable.focus();
    await expect(firstFocusable).toBeFocused();

    // Shift+Tab on first element wraps to last element
    await page.keyboard.press("Shift+Tab");
    await expect(lastFocusable).toBeFocused();

    // Tab on last element wraps to first element
    await page.keyboard.press("Tab");
    await expect(firstFocusable).toBeFocused();

    // 2. In-flight save date navigation: hold Date 1 response, navigate to Date 2, assert Date 2 editor and draft not closed/cleared when old response settles
    const habitRow = dialog.locator(`[data-habit="${habit.id}"]`);
    let resolvePut: (() => void) | null = null;
    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise<void>((resolve) => {
          resolvePut = resolve;
        });
        await route.continue();
      } else {
        await route.continue();
      }
    });

    // Start save on Date 1 (today)
    const todayBtn = dateButtons.last();
    await todayBtn.click();
    await habitRow.getByRole("button", { name: /Record Keyboard Habit/ }).click();
    const editor = habitRow.locator(".habit-history-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("15");
    await editor.getByLabel(/^Note/).fill("Date 1 save in flight");
    await editor.getByRole("button", { name: "Save" }).click();

    await expect(editor.getByRole("button", { name: "Saving…" })).toBeVisible();

    // Navigate to Date 2 while save is in flight
    await dateButtons.nth(6).click();
    await expect(dateButtons.nth(6)).toHaveAttribute("aria-pressed", "true");

    // On Date 2, editor is already open for this habit
    const editorDate2 = habitRow.locator(".habit-history-editor");
    await expect(editorDate2).toBeVisible();
    await editorDate2.getByLabel(/^Amount/).fill("99");
    await editorDate2.getByLabel(/^Note/).fill("Date 2 draft in progress");

    // Settle Date 1 save and await owned response + UI settlement
    expect(resolvePut).not.toBeNull();
    const date1PutResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/check-in") && r.request().method() === "PUT" && r.status() === 200
    );
    resolvePut!();
    await date1PutResponsePromise;

    // Await post-save settled barrier: header buttons re-enable and busy indicators clear
    await expect(dialog.getByRole("button", { name: "Refresh habit history" })).toBeEnabled();
    await expect(editorDate2.locator(".habit-history-busy-note")).not.toBeVisible();

    // On Date 2, editor is STILL OPEN with intact draft
    await expect(editorDate2).toBeVisible();
    await expect(editorDate2.getByLabel(/^Amount/)).toHaveValue("99");
    await expect(editorDate2.getByLabel(/^Note/)).toHaveValue("Date 2 draft in progress");

    // 3. Switch dates and return preserving keyed draft
    await todayBtn.click();
    await expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    await dateButtons.nth(6).click();
    await expect(dateButtons.nth(6)).toHaveAttribute("aria-pressed", "true");
    await expect(editorDate2).toBeVisible();
    await expect(editorDate2.getByLabel(/^Amount/)).toHaveValue("99");
    await expect(editorDate2.getByLabel(/^Note/)).toHaveValue("Date 2 draft in progress");

    // 4. Escape with dirty unsent draft prompts discard warning
    await page.keyboard.press("Escape");
    const discardDialog = page.getByRole("alertdialog", { name: "Discard unsaved edits?" });
    await expect(discardDialog).toBeVisible();

    // 5. "Keep editing" retains draft and focus inside dialog
    const keepBtn = discardDialog.getByRole("button", { name: "Keep editing" });
    await expect(keepBtn).toBeVisible();
    await keepBtn.click();

    await expect(discardDialog).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(editorDate2).toBeVisible();
    await expect(editorDate2.getByLabel(/^Amount/)).toHaveValue("99");
    await expect(editorDate2.getByLabel(/^Note/)).toHaveValue("Date 2 draft in progress");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const active = document.activeElement;
        const modal = document.querySelector(".habit-history-dialog");
        return Boolean(active && active !== document.body && modal?.contains(active));
      });
    }).toBe(true);

    // 6. Escape again and click "Discard and close": closes dialog and restores History opener focus immediately
    await page.keyboard.press("Escape");
    await expect(discardDialog).toBeVisible();

    const discardBtn = discardDialog.getByRole("button", { name: "Discard and close" });
    await discardBtn.click();

    await expect(discardDialog).not.toBeVisible();
    await expect(dialog).not.toBeVisible();
    await expect(historyBtn).toBeFocused();
  });

  test("Confirmation focus lifecycle: Keep editing and confirmation Escape return inside dialog, clean close returns to History opener", async ({ page }) => {
    const habit = await createHabit(page, "Focus Cycle Habit");

    await openToday(page);
    const historyBtn = page.getByRole("button", { name: "History" });
    await historyBtn.click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Refresh habit history" })).toBeEnabled();

    // 1. Clean close from freshly opened dialog returns focus to History opener
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(historyBtn).toBeFocused();

    // Reopen dialog and enter dirty draft
    await historyBtn.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Refresh habit history" })).toBeEnabled();

    const habitRow = dialog.locator(`[data-habit="${habit.id}"]`);
    await habitRow.getByRole("button", { name: /Record Focus Cycle Habit/ }).click();
    const editor = habitRow.locator(".habit-history-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel(/^Note/).fill("Unsaved draft for focus cycle");

    // 2. Escape triggers confirmation; Keep editing returns focus inside main dialog with draft intact
    await page.keyboard.press("Escape");
    const discardDialog = page.getByRole("alertdialog", { name: "Discard unsaved edits?" });
    await expect(discardDialog).toBeVisible();

    const keepBtn = discardDialog.getByRole("button", { name: "Keep editing" });
    await keepBtn.click();

    await expect(discardDialog).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(editor.getByLabel(/^Note/)).toHaveValue("Unsaved draft for focus cycle");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const active = document.activeElement;
        const modal = document.querySelector(".habit-history-dialog");
        return Boolean(active && active !== document.body && modal?.contains(active));
      });
    }).toBe(true);

    // 3. Escape triggers confirmation again; pressing Escape on confirmation dismisses it without closing History
    await page.keyboard.press("Escape");
    await expect(discardDialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(discardDialog).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(editor.getByLabel(/^Note/)).toHaveValue("Unsaved draft for focus cycle");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const active = document.activeElement;
        const modal = document.querySelector(".habit-history-dialog");
        return Boolean(active && active !== document.body && modal?.contains(active));
      });
    }).toBe(true);

    // 4. Cancel editing (clearing dirty state) and clean close via Close button returns focus to History opener
    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(editor).not.toBeVisible();

    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(historyBtn).toBeFocused();
  });
});

test.describe("Habit History (Labelled Mocked Fault Scenarios)", () => {
  const mockHistoryPayload: HabitHistoryPayload = {
    todayKey: "2026-09-26",
    earliestDate: "2026-09-19",
    latestDate: "2026-09-26",
    habits: [
      {
        id: "mock-habit-1",
        name: "Evening Stroll",
        cadence: "DAILY",
        targetPerWeek: 7,
        status: "ACTIVE",
        sortOrder: 0,
        createdAt: "2026-09-18T00:00:00.000Z",
        archivedAt: null,
        createdDay: "2026-09-18",
        archivedDay: null
      }
    ],
    checkIns: []
  };

  test("MOCKED FAULT: global pending UI disables concurrent saves and check status while preserving draft editing and navigation", async ({ page }) => {
    const multiHabitPayload: HabitHistoryPayload = {
      ...mockHistoryPayload,
      habits: [
        mockHistoryPayload.habits[0],
        {
          id: "mock-habit-2",
          name: "Morning Meditation",
          cadence: "DAILY",
          targetPerWeek: 7,
          status: "ACTIVE",
          sortOrder: 1,
          createdAt: "2026-09-18T00:00:00.000Z",
          archivedAt: null,
          createdDay: "2026-09-18",
          archivedDay: null
        }
      ]
    };

    let historyState = multiHabitPayload;
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(historyState)
      });
    });

    const saveGate: { resolve?: () => void } = {};
    await page.route("**/api/habits/mock-habit-1/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise<void>((resolve) => {
          saveGate.resolve = resolve;
        });
        const saved = {
          id: "ci-1",
          habitId: "mock-habit-1",
          date: "2026-09-26T12:00:00.000Z",
          day: "2026-09-26",
          done: true,
          amount: null,
          note: null
        };
        historyState = {
          ...historyState,
          checkIns: [...historyState.checkIns, saved]
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(saved)
        });
      } else {
        await route.continue();
      }
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const row1 = dialog.locator('[data-habit="mock-habit-1"]');
    const row2 = dialog.locator('[data-habit="mock-habit-2"]');

    // Start save on Habit 1
    await row1.getByRole("button", { name: /Record/ }).click();
    const editor1 = row1.locator(".habit-history-editor");
    await editor1.getByRole("button", { name: "Done", exact: true }).click();
    await editor1.getByRole("button", { name: "Save" }).click();

    // Habit 1 is now in-flight saving
    await expect(editor1.getByRole("button", { name: "Saving…" })).toBeVisible();

    // Dialog Header actions are disabled while any save is in flight
    await expect(dialog.getByRole("button", { name: "Refresh habit history" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close habit history" })).toBeDisabled();

    // Start editing Habit 2 while Habit 1 is saving
    await row2.getByRole("button", { name: /Record/ }).click();
    const editor2 = row2.locator(".habit-history-editor");
    await expect(editor2).toBeVisible();

    // Draft editing is NOT blocked: user can still mark Done and enter text
    await editor2.getByRole("button", { name: "Done", exact: true }).click();
    await editor2.getByLabel(/^Note/).fill("Mindful breathing");

    // But Habit 2's Save button is disabled and displays visible busy note
    const save2Btn = editor2.getByRole("button", { name: "Save" });
    await expect(save2Btn).toBeDisabled();
    await expect(save2Btn).toHaveAttribute("title", "Another check-in save is still finishing.");
    await expect(editor2.locator(".habit-history-busy-note")).toContainText("Another save in progress…");

    // Now resolve Habit 1 save
    saveGate.resolve?.();

    // Habit 1 completes and closes
    await expect(editor1).not.toBeVisible();
    await expect(row1.locator(".habit-history-state-tag--done")).toContainText("Done");

    // Habit 2's Save button becomes enabled and busy note clears
    await expect(save2Btn).toBeEnabled();
    await expect(editor2.locator(".habit-history-busy-note")).not.toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close habit history" })).toBeEnabled();
  });

  test("MOCKED FAULT: network failure on save retains uncertain intention, disables inputs, and provides exact-date reconciliation with truthful accessible name", async ({ page }) => {
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryPayload)
      });
    });

    // Mock PUT to simulate a dropped network response
    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator('[data-habit="mock-habit-1"]');

    await habitRow.getByRole("button", { name: /Record/ }).click();
    const editor = habitRow.locator(".habit-history-editor");

    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("5");
    await editor.getByLabel(/^Note/).fill("Walked around the block");

    await editor.getByRole("button", { name: "Save" }).click();

    // After failed PUT, the mutation is marked uncertain
    // Inputs are disabled against new intention changes
    await expect(editor.getByLabel(/^Amount/)).toBeDisabled();
    await expect(editor.getByLabel(/^Note/)).toBeDisabled();

    // "Check status" reconciliation button is visible with truthful accessible name
    const checkStatusBtn = editor.getByRole("button", {
      name: /^Check status for Evening Stroll on 2026-09-26/
    });
    await expect(checkStatusBtn).toBeVisible();

    // Save button allows retry of the same intention
    const retryBtn = editor.getByRole("button", { name: /Retry save/ });
    await expect(retryBtn).toBeVisible();

    // Mock GET reconciliation endpoint to return confirmed check-in
    await page.route("**/api/habits/*/check-in?date=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          todayKey: "2026-09-26",
          earliestDate: "2026-09-19",
          latestDate: "2026-09-26",
          habitId: "mock-habit-1",
          date: "2026-09-26",
          checkIn: {
            id: "reconciled-ci-1",
            habitId: "mock-habit-1",
            date: "2026-09-26T12:00:00.000Z",
            day: "2026-09-26",
            done: true,
            amount: 5,
            note: "Walked around the block"
          }
        })
      });
    });

    // Click Check status
    await checkStatusBtn.click();

    // After reconciliation, evidence updates and editor closes
    await expect(editor).not.toBeVisible();
    await expect(habitRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(habitRow.getByText("Amount: 5")).toBeVisible();
  });

  test("Proof 3: MOCKED FAULT: lost-response -> stale original receipt RETRY preserves newer displayed fact with acknowledged banner and GET-only refresh", async ({ page }) => {
    const habit = await createHabit(page, "Evening Stroll");

    let firstPutCommitted = false;
    let firstMutationId: string | null = null;
    let firstPayload: any = null;
    let retryMutationId: string | null = null;
    let retryPayload: any = null;
    let failTrailingHistory = false;
    let retryPutReqCount = 0;
    let historyGetReqCount = 0;

    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        retryPutReqCount++;
        const headers = route.request().headers();
        if (!firstPutCommitted) {
          firstPutCommitted = true;
          firstPayload = route.request().postDataJSON();
          firstMutationId = headers["x-dayflow-mutation-id"] ?? null;
          // Execute mutation on real server (first mutation committed)
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          // Abort response to client (simulating client-side network drop)
          await route.abort("failed");
          return;
        }
        // Capture retry details
        retryPayload = route.request().postDataJSON();
        retryMutationId = headers["x-dayflow-mutation-id"] ?? null;
        await route.continue();
        return;
      }
      await route.continue();
    });

    await page.route("**/api/habits/history", async (route) => {
      historyGetReqCount++;
      if (failTrailingHistory) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "History could not be refreshed." })
        });
        return;
      }
      await route.continue();
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const historyRes = await page.request.get("/api/habits/history");
    expect(historyRes.ok()).toBe(true);
    const { todayKey } = await historyRes.json();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator(`[data-habit="${habit.id}"]`);
    const dateButtons = dialog.locator("button.habit-history-date-btn");
    const todayBtn = dateButtons.last();
    await todayBtn.click();

    // 1. Initial attempt: Save with Amount 5 and Note "Walked in park"
    await habitRow.getByRole("button", { name: /Record Evening Stroll/ }).click();
    const editor = habitRow.locator(".habit-history-editor");
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("5");
    await editor.getByLabel(/^Note/).fill("Walked in park");

    await editor.getByRole("button", { name: "Save" }).click();

    // Failed response leaves uncertain state and displays Retry save button
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();
    const retryBtn = editor.getByRole("button", { name: /Retry save/ });
    await expect(retryBtn).toBeVisible();

    // 2. Apply intervening server edit directly via page.request
    const editRes = await page.request.put(`/api/habits/${habit.id}/check-in`, {
      data: {
        date: todayKey,
        done: false,
        amount: 0,
        note: "Intervening server edit"
      }
    });
    expect(editRes.ok()).toBe(true);

    // 3. Refresh history to publish newer row
    await dialog.getByRole("button", { name: "Refresh habit history" }).click();

    // The newer row state tag is now updated on screen
    await expect(habitRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");

    // Original unchanged intention is still retained in editor
    await expect(editor.getByLabel(/^Amount/)).toHaveValue("5");
    await expect(editor.getByLabel(/^Note/)).toHaveValue("Walked in park");
    await expect(retryBtn).toBeVisible();

    // 4. Set trailing history refresh to fail and click Retry save
    failTrailingHistory = true;
    retryPutReqCount = 0;
    historyGetReqCount = 0;

    const [retryResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/check-in") && r.request().method() === "PUT"),
      retryBtn.click()
    ]);
    expect(retryResponse.ok()).toBe(true);

    // Assert real nonempty UUID header was captured and matches on retry
    expect(typeof firstMutationId).toBe("string");
    expect(firstMutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(retryMutationId).toBe(firstMutationId);
    expect(retryPayload).toEqual(firstPayload);

    // Wait for acknowledged/refresh-failed settlement
    const warningBanner = dialog.locator(".habit-history-banner--warning");
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText("The save was acknowledged, but the current record could not be refreshed. The on-screen record was left in place.");

    // Assert original receipt did NOT replace newer displayed fact
    await expect(habitRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(habitRow.getByText("“Intervening server edit”")).toBeVisible();
    await expect(habitRow.getByText("Walked in park")).not.toBeVisible();

    // 5. Click "Retry refresh" in the banner: issues GET only, not another PUT
    failTrailingHistory = false;
    retryPutReqCount = 0;
    historyGetReqCount = 0;

    await warningBanner.getByRole("button", { name: "Retry refresh" }).click();
    await expect(warningBanner).not.toBeVisible();

    expect(retryPutReqCount).toBe(0);
    expect(historyGetReqCount).toBeGreaterThanOrEqual(1);

    // Newer fact remains intact
    await expect(habitRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(habitRow.getByText("“Intervening server edit”")).toBeVisible();
  });

  test("Proof 4: MOCKED FAULT: expired 400 after uncertainty retains check-status, disables writes, and names original date on exact-date GET", async ({ page }) => {
    let currentHistory: HabitHistoryPayload = {
      todayKey: "2026-09-26",
      earliestDate: "2026-09-19",
      latestDate: "2026-09-26",
      habits: [
        {
          id: "mock-habit-1",
          name: "Evening Stroll",
          cadence: "DAILY",
          targetPerWeek: 7,
          status: "ACTIVE",
          sortOrder: 0,
          createdAt: "2026-09-18T00:00:00.000Z",
          archivedAt: null,
          createdDay: "2026-09-18",
          archivedDay: null
        }
      ],
      checkIns: []
    };

    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentHistory)
      });
    });

    let putCount = 0;
    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        putCount++;
        if (putCount === 1) {
          // First attempt: network abort
          await route.abort("failed");
          return;
        }
        if (putCount === 2) {
          // Second attempt: 400 validation error
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: "2026-09-19 is outside the 8-day writable window.",
              code: "VALIDATION_ERROR",
              field: "date"
            })
          });
          return;
        }
      }
      await route.continue();
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator('[data-habit="mock-habit-1"]');

    // 1. Select the oldest writable date (2026-09-19)
    const dateButtons = dialog.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);
    await dateButtons.first().click();

    // 2. Start recording and lose save response
    await habitRow.getByRole("button", { name: /Record/ }).click();
    const editor = habitRow.locator(".habit-history-editor");
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("10");
    await editor.getByLabel(/^Note/).fill("Oldest day attempt");

    await editor.getByRole("button", { name: "Save" }).click();

    // First failure leaves uncertain attempt
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();
    const retryBtn = editor.getByRole("button", { name: /Retry save/ });
    await expect(retryBtn).toBeVisible();

    const checkStatusBtn = editor.getByRole("button", {
      name: /^Check status for Evening Stroll on 2026-09-19/
    });
    await expect(checkStatusBtn).toBeVisible();

    // 3. Before loaded window advances, same-ID retry gets server 400 VALIDATION_ERROR field date
    const [put400Response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/check-in") && r.request().method() === "PUT" && r.status() === 400
      ),
      retryBtn.click()
    ]);
    expect(put400Response.status()).toBe(400);

    // Assert UI date validation error appears
    await expect(editor.locator(".form-error")).toContainText(
      "2026-09-19 is outside the 8-day writable window."
    );

    // Check status must remain available (not falsely considered definitely failed)
    await expect(checkStatusBtn).toBeVisible();
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();

    // 4. Advance mocked SERVER window by one calendar day:
    currentHistory = {
      ...currentHistory,
      todayKey: "2026-09-27",
      earliestDate: "2026-09-20",
      latestDate: "2026-09-27"
    };

    // Refresh history
    await dialog.getByRole("button", { name: "Refresh habit history" }).click();

    // Assert original selected date (2026-09-19) is retained!
    await expect(dialog.locator(".habit-history-selected-notice")).toContainText("2026-09-19 (Read-only)");

    // Expired banner is visible
    const banner = dialog.locator(".habit-history-banner--info");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("2026-09-19 is outside the 8-day writable window");
    await expect(banner).toContainText("Records for this date are read-only.");

    // Writes disabled: Retry save button is disabled
    await expect(retryBtn).toBeDisabled();

    // Retains uncertain intention and draft
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();
    await expect(editor.getByLabel(/^Amount/)).toHaveValue("10");
    await expect(editor.getByLabel(/^Note/)).toHaveValue("Oldest day attempt");

    // Check status is visible and enabled
    await expect(checkStatusBtn).toBeVisible();
    await expect(checkStatusBtn).toBeEnabled();

    // 5. Exact-date GET must name original date in query
    let requestedDateParam: string | null = null;
    await page.route("**/api/habits/*/check-in?date=*", async (route) => {
      const url = new URL(route.request().url());
      requestedDateParam = url.searchParams.get("date");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          todayKey: "2026-09-27",
          earliestDate: "2026-09-20",
          latestDate: "2026-09-27",
          habitId: "mock-habit-1",
          date: "2026-09-19",
          checkIn: {
            id: "reconciled-expired-1",
            habitId: "mock-habit-1",
            date: "2026-09-19T12:00:00.000Z",
            day: "2026-09-19",
            done: true,
            amount: 10,
            note: "Oldest day attempt"
          }
        })
      });
    });

    await checkStatusBtn.click();

    expect(requestedDateParam).toBe("2026-09-19");
    await expect(editor).not.toBeVisible();
    await expect(habitRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(habitRow.getByText("Amount: 10")).toBeVisible();
    await expect(habitRow.getByText("“Oldest day attempt”")).toBeVisible();
  });

  test("MOCKED FAULT: saved-write / read-refresh-failure displays warning banner without falsifying write, and enables GET-only retry", async ({ page }) => {
    let returnLoadError = false;
    let historyState = mockHistoryPayload;

    await page.route("**/api/habits/history", async (route) => {
      if (returnLoadError) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Habit history could not be loaded." })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(historyState)
        });
      }
    });

    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        // Successful write
        returnLoadError = true; // Trailing history refresh will fail!
        const saved = {
          id: "saved-ci-1",
          habitId: "mock-habit-1",
          date: "2026-09-26T12:00:00.000Z",
          day: "2026-09-26",
          done: true,
          amount: 3,
          note: "Saved before refresh failed"
        };
        historyState = {
          ...historyState,
          checkIns: [...historyState.checkIns, saved]
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(saved)
        });
      } else {
        await route.continue();
      }
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator('[data-habit="mock-habit-1"]');

    await habitRow.getByRole("button", { name: /Record/ }).click();
    const editor = habitRow.locator(".habit-history-editor");

    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("3");
    await editor.getByLabel(/^Note/).fill("Saved before refresh failed");

    await editor.getByRole("button", { name: "Save" }).click();

    // Editor closes because save itself was confirmed
    await expect(editor).not.toBeVisible();

    // Confirmed check-in is displayed on screen
    await expect(habitRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(habitRow.getByText("Amount: 3")).toBeVisible();

    // Warning banner appears indicating history refresh failure
    const warningBanner = dialog.locator(".habit-history-banner--warning");
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText("History could not be refreshed. Confirmed check-ins already on screen stay put.");

    // Now allow refresh to succeed
    returnLoadError = false;

    // Track requests to verify only GET is issued, no PUT
    let putCount = 0;
    let getCount = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/habits")) {
        if (req.method() === "PUT") putCount++;
        if (req.method() === "GET" && req.url().includes("/history")) getCount++;
      }
    });

    // Click "Retry refresh" in the banner
    await warningBanner.getByRole("button", { name: "Retry refresh" }).click();

    // Warning banner disappears
    await expect(warningBanner).not.toBeVisible();

    // Confirmed check-in remains intact
    await expect(habitRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    expect(putCount).toBe(0);
    expect(getCount).toBeGreaterThanOrEqual(1);
  });
});
