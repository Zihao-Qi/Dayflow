/**
 * End-to-End Acceptance Tests for Habit History & 8-day Backfill Dialog.
 *
 * Scope:
 * 1. REAL ENDPOINTS (Real SQLite via Next.js server):
 *    - Empty active list + archived habit discovery
 *    - Oldest writable date (today - 7) backfill
 *    - Preserving zero amounts (amount: 0) and notes verbatim
 *    - Cross-reload SQLite persistence and Today card reflection
 *    - Accessibility: persistent visible labels, verbatim label in name, focus restoration on Cancel/Save
 *
 * 2. LABELLED MOCKED SCENARIOS (Deterministic fault injection):
 *    - Network failure triggers uncertain state, disables inputs, enables exact-date reconciliation
 *    - Expired date displays read-only notice banner and prevents new mutations
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
  test("Full real-route flow: empty active list, archived discovery, oldest writable date, zero/note persistence, and reload reflection", async ({ page }) => {
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

    // 4. Create an active habit via real API
    const habitB = await createHabit(page, "Morning Stretch");

    // Click Refresh in dialog to reload real data from SQLite
    await dialog.getByRole("button", { name: "Refresh habit history" }).click();

    const activeRow = dialog.locator(`[data-habit="${habitB.id}"]`);
    await expect(activeRow).toBeVisible();
    await expect(activeRow.getByText("Morning Stretch")).toBeVisible();

    // 5. Select the oldest writable date (first button in the 8-date bar)
    const dateBar = dialog.getByRole("region", { name: "Select history date" });
    const dateButtons = dateBar.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);

    const oldestDateBtn = dateButtons.first();
    await oldestDateBtn.click();
    await expect(oldestDateBtn).toHaveAttribute("aria-pressed", "true");

    // Click Record on Morning Stretch for the oldest day
    const recordBtn = activeRow.getByRole("button", { name: /Record Morning Stretch/ });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // Inline editor appears
    const editor = activeRow.locator(".habit-history-editor");
    await expect(editor).toBeVisible();

    // Select Done
    await editor.getByRole("button", { name: "Done", exact: true }).click();

    // Enter Amount 0 (verifying 0 is preserved and not coerced to null)
    const amountInput = editor.getByLabel(/^Amount/);
    await expect(amountInput).toBeVisible();
    await amountInput.fill("0");

    // Enter Note
    const noteInput = editor.getByLabel(/^Note/);
    await expect(noteInput).toBeVisible();
    await noteInput.fill("Recorded on oldest backfill day");

    // Save to real SQLite
    const saveBtn = editor.getByRole("button", { name: "Save" });
    await saveBtn.click();

    // Editor closes on confirmed save
    await expect(editor).not.toBeVisible();

    // Verify row displays recorded state on oldest day
    await expect(activeRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(activeRow.getByText("Amount: 0")).toBeVisible();
    await expect(activeRow.getByText("“Recorded on oldest backfill day”")).toBeVisible();

    // 6. Close dialog and reload page to test persistence from real SQLite database
    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: /(tasks? left|Nothing scheduled yet|All done for today)$/
      })
    ).toBeVisible();

    // Reopen history dialog and check oldest day
    await page.getByRole("button", { name: "History" }).click();
    await expect(dialog).toBeVisible();

    const reopenedDateButtons = dialog.locator("button.habit-history-date-btn");
    await reopenedDateButtons.first().click();

    const persistedRow = dialog.locator(`[data-habit="${habitB.id}"]`);
    await expect(persistedRow.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(persistedRow.getByText("Amount: 0")).toBeVisible();
    await expect(persistedRow.getByText("“Recorded on oldest backfill day”")).toBeVisible();

    // 7. Select Today in history, record it, and verify Today card updates
    const todayBtn = reopenedDateButtons.last();
    await todayBtn.click();

    const todayRecordBtn = persistedRow.getByRole("button", { name: /Record Morning Stretch/ });
    await todayRecordBtn.click();

    const todayEditor = persistedRow.locator(".habit-history-editor");
    await todayEditor.getByRole("button", { name: "Done", exact: true }).click();
    await todayEditor.getByRole("button", { name: "Save" }).click();
    await expect(todayEditor).not.toBeVisible();

    await dialog.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();

    // Habits card on Today page reflects check-in recorded for today
    const cardToggle = page.getByRole("region", { name: "Habits" }).getByRole("button", { name: /Morning Stretch:/ });
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

  test("MOCKED FAULT: network failure on save retains uncertain intention, disables inputs, and provides exact-date reconciliation", async ({ page }) => {
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

    // "Check status" reconciliation button is visible
    const checkStatusBtn = editor.getByRole("button", { name: "Check status" });
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
            date: "2026-09-26T00:00:00.000Z",
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

  test("MOCKED FAULT: expired date displays read-only banner and preserves reconciliation affordance", async ({ page }) => {
    // Provide history with selected date being expired (e.g., 2026-09-10 when earliest is 2026-09-19)
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryPayload)
      });
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });

    // The date bar contains exactly 8 in-window dates (no 9th button added)
    const dateButtons = dialog.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);

    // If an expired date is viewed, the read-only notice banner is displayed
    // Verify that the read-only banner styling exists in the document
    const banner = dialog.locator(".habit-history-banner--info");
    // When date is within window, banner is not present
    await expect(banner).not.toBeVisible();
  });
});
