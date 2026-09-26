/**
 * End-to-End Acceptance Tests for Habit History & 8-day Backfill Dialog.
 *
 * Scope:
 * 1. REAL ENDPOINTS (Real SQLite via Next.js server):
 *    - Empty active list + archived habit discovery
 *    - Archived habit post-archive false record (done: false within window)
 *    - Omitted field preservation vs null clearing on edit
 *    - Cross-reload SQLite persistence and Today card reflection
 *    - Accessibility: persistent visible labels, verbatim label in name, focus restoration on Cancel/Save
 *
 * 2. LABELLED MOCKED SCENARIOS (Deterministic fault injection):
 *    - Global pending UI: in-flight save blocks concurrent saves and check status while preserving draft edits
 *    - Network failure triggers uncertain state, disables inputs, enables exact-date reconciliation with accessible name
 *    - U2 chronology: expired date displays read-only notice banner, disables Save, retains uncertain intention, and preserves exact-date reconciliation
 *    - Saved-write / read-refresh-failure displays warning banner without falsifying write, enabling GET-only retry
 */

import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";
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

async function archiveHabit(page: Page, habitId: string) {
  const archived = await page.request.post(`/api/habits/${habitId}/archive`);
  expect(archived.ok(), await archived.text()).toBe(true);
  return archived.json();
}

test.describe("Habit History & Backfill (Real Routes)", () => {
  test("Full real-route flow: archived habit post-archive false record, omitted vs cleared fields, and reload persistence", async ({ page }) => {
    // 1. Create a habit and immediately archive it so active list is empty
    const habitA = await createHabit(page, "Archived Habit A");
    await archiveHabit(page, habitA.id);

    await openToday(page);

    // 2. "History" button is accessible in HabitsCard header even with 0 active habits
    const historyBtn = page.getByRole("button", { name: "History" });
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();

    // Active list is empty: "No habits found."
    await expect(dialog.getByText("No habits found.")).toBeVisible();

    // 3. Disclose archived habits
    const archivedToggle = dialog.getByLabel(/Show archived/);
    await expect(archivedToggle).toBeVisible();
    await archivedToggle.check();

    const archivedRow = dialog.locator(`[data-habit="${habitA.id}"]`);
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByText("Archived")).toBeVisible();

    // 4. Record post-archive explicit false (Not done) on the oldest writable date
    const dateBar = dialog.getByRole("region", { name: "Select history date" });
    const dateButtons = dateBar.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);

    const oldestDateBtn = dateButtons.first();
    await oldestDateBtn.click();
    await expect(oldestDateBtn).toHaveAttribute("aria-pressed", "true");

    const recordArchivedBtn = archivedRow.getByRole("button", { name: /Record Archived Habit A/ });
    await expect(recordArchivedBtn).toBeVisible();
    await recordArchivedBtn.click();

    const archivedEditor = archivedRow.locator(".habit-history-editor");
    await expect(archivedEditor).toBeVisible();

    // Select "Not done" (explicit false record)
    await archivedEditor.getByRole("button", { name: "Not done", exact: true }).click();
    await archivedEditor.getByLabel(/^Amount/).fill("0");
    await archivedEditor.getByLabel(/^Note/).fill("Archived miss recorded");

    const saveArchivedBtn = archivedEditor.getByRole("button", { name: "Save" });
    await saveArchivedBtn.click();

    await expect(archivedEditor).not.toBeVisible();
    await expect(archivedRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(archivedRow.getByText("Amount: 0")).toBeVisible();
    await expect(archivedRow.getByText("“Archived miss recorded”")).toBeVisible();

    // 5. Create an active habit via real API
    const habitB = await createHabit(page, "Hydration");

    // Click Refresh in dialog to reload real data from SQLite
    await dialog.getByRole("button", { name: "Refresh habit history" }).click();

    const activeRow = dialog.locator(`[data-habit="${habitB.id}"]`);
    await expect(activeRow).toBeVisible();
    await expect(activeRow.getByText("Hydration")).toBeVisible();

    // 6. Record on Today with initial amount & note
    const todayBtn = dateButtons.last();
    await todayBtn.click();
    await expect(todayBtn).toHaveAttribute("aria-pressed", "true");

    const recordTodayBtn = activeRow.getByRole("button", { name: /Record Hydration/ });
    await recordTodayBtn.click();

    const activeEditor = activeRow.locator(".habit-history-editor");
    await activeEditor.getByRole("button", { name: "Done", exact: true }).click();
    await activeEditor.getByLabel(/^Amount/).fill("8");
    await activeEditor.getByLabel(/^Note/).fill("8 glasses of water");
    await activeEditor.getByRole("button", { name: "Save" }).click();
    await expect(activeEditor).not.toBeVisible();

    await expect(activeRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(activeRow.getByText("Amount: 8")).toBeVisible();
    await expect(activeRow.getByText("“8 glasses of water”")).toBeVisible();

    // 7. Omitted field preservation: Edit without touching Amount or Note
    const editBtn = activeRow.getByRole("button", { name: /Edit Hydration/ });
    await editBtn.click();
    await expect(activeEditor).toBeVisible();

    // Click Save directly without typing into Amount or Note
    await activeEditor.getByRole("button", { name: "Save" }).click();
    await expect(activeEditor).not.toBeVisible();

    // Amount: 8 and note must still be preserved verbatim
    await expect(activeRow.getByText("Amount: 8")).toBeVisible();
    await expect(activeRow.getByText("“8 glasses of water”")).toBeVisible();

    // 8. Null clearing: Edit and explicitly clear Amount and Note
    await activeRow.getByRole("button", { name: /Edit Hydration/ }).click();
    await expect(activeEditor).toBeVisible();

    await activeEditor.getByLabel(/^Amount/).fill("");
    await activeEditor.getByLabel(/^Note/).fill("");
    await activeEditor.getByRole("button", { name: "Save" }).click();
    await expect(activeEditor).not.toBeVisible();

    // State is still Done, but Amount and Note are cleared
    await expect(activeRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(activeRow.getByText("Amount: 8")).not.toBeVisible();
    await expect(activeRow.getByText("“8 glasses of water”")).not.toBeVisible();

    // 9. Close dialog and reload page to test persistence from real SQLite database
    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: /(tasks? left|Nothing scheduled yet|All done for today)$/
      })
    ).toBeVisible();

    // Reopen history dialog and check oldest day for Habit A
    await page.getByRole("button", { name: "History" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Show archived/).check();

    const reopenedDateButtons = dialog.locator("button.habit-history-date-btn");
    await reopenedDateButtons.first().click();

    const persistedArchivedRow = dialog.locator(`[data-habit="${habitA.id}"]`);
    await expect(persistedArchivedRow.locator(".habit-history-state-tag--notDone")).toContainText("Not done");
    await expect(persistedArchivedRow.getByText("Amount: 0")).toBeVisible();
    await expect(persistedArchivedRow.getByText("“Archived miss recorded”")).toBeVisible();

    // Check Today for Habit B
    await reopenedDateButtons.last().click();
    const persistedActiveRow = dialog.locator(`[data-habit="${habitB.id}"]`);
    await expect(persistedActiveRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(persistedActiveRow.getByText("Amount:")).not.toBeVisible();

    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();

    // Habits card on Today page reflects check-in recorded for today
    const cardToggle = page.getByRole("region", { name: "Habits" }).getByRole("button", { name: /Hydration:/ });
    await expect(cardToggle).toHaveAttribute("aria-pressed", "true");
    await expect(cardToggle).toContainText("done today");
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

  test("MOCKED FAULT: U2 chronology — expired date displays read-only notice banner, disables Save, retains uncertain intention, and preserves exact-date reconciliation", async ({ page }) => {
    let currentHistory = mockHistoryPayload;

    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentHistory)
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

    // 1. Select the oldest writable date (2026-09-19)
    const dateButtons = dialog.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);
    await dateButtons.first().click();

    // In-window date: read-only notice banner is NOT visible
    const banner = dialog.locator(".habit-history-banner--info");
    await expect(banner).not.toBeVisible();

    // 2. Start recording on the oldest date and lose save response
    await habitRow.getByRole("button", { name: /Record/ }).click();
    const editor = habitRow.locator(".habit-history-editor");

    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await editor.getByLabel(/^Amount/).fill("10");
    await editor.getByLabel(/^Note/).fill("Oldest day attempt");

    await editor.getByRole("button", { name: "Save" }).click();

    // Mutation becomes uncertain
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();
    const retryBtn = editor.getByRole("button", { name: /Retry save/ });
    await expect(retryBtn).toBeVisible();

    // 3. Advance mocked SERVER window by one calendar day:
    // Window shifts from 2026-09-19..2026-09-26 to 2026-09-20..2026-09-27.
    // 2026-09-19 is now an EXPIRED date!
    currentHistory = {
      ...mockHistoryPayload,
      todayKey: "2026-09-27",
      earliestDate: "2026-09-20",
      latestDate: "2026-09-27"
    };

    // Refresh history
    await dialog.getByRole("button", { name: "Refresh habit history" }).click();

    // 4. Assert original selected date (2026-09-19) is retained!
    await expect(dialog.locator(".habit-history-selected-notice")).toContainText("2026-09-19 (Read-only)");

    // 5. Exactly eight writable buttons in the date bar
    await expect(dateButtons).toHaveCount(8);

    // 6. Expired banner IS VISIBLE and truthful!
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("2026-09-19 is outside the 8-day writable window");
    await expect(banner).toContainText("Records for this date are read-only.");

    // 7. Save button is DISABLED on the expired date!
    await expect(retryBtn).toBeDisabled();

    // 8. Uncertain intention is retained!
    await expect(habitRow.getByText("Save uncertain")).toBeVisible();

    // 9. Reconciliation affordance is preserved even on expired date!
    const checkStatusBtn = editor.getByRole("button", {
      name: /^Check status for Evening Stroll on 2026-09-19/
    });
    await expect(checkStatusBtn).toBeVisible();
    await expect(checkStatusBtn).toBeEnabled();

    // 10. Exact-date GET for original now-expired date returns truthful result
    await page.route("**/api/habits/*/check-in?date=2026-09-19", async (route) => {
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

    // 11. After reconciliation, editor closes and truthful evidence shows Done
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
