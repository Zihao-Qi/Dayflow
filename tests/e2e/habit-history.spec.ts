/**
 * MOCKED BROWSER TEST (API branch in flight; mocking pinned contract for browser validation)
 *
 * Validates the separate Habit History & 8-day Backfill Dialog against the pinned HTTP contract:
 * - GET /api/habits/history
 * - GET /api/habits/[id]/check-in?date=YYYY-MM-DD
 * - PUT /api/habits/[id]/check-in
 *
 * Final real-route acceptance will run after Pi integrates the reviewed backend branch.
 */

import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";
import type { HabitHistoryPayload, HabitCheckInReconciliation } from "../../src/modules/evidence/ui/history-api";

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

const mockHistoryData: HabitHistoryPayload = {
  todayKey: "2026-09-26",
  earliestDate: "2026-09-19",
  latestDate: "2026-09-26",
  habits: [
    {
      id: "habit-active-1",
      name: "Morning Stretch",
      cadence: "DAILY",
      targetPerWeek: 7,
      status: "ACTIVE",
      sortOrder: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      archivedAt: null,
      createdDay: "2026-09-20",
      archivedDay: null
    },
    {
      id: "habit-active-2",
      name: "Read 10 pages",
      cadence: "TIMES_PER_WEEK",
      targetPerWeek: 5,
      status: "ACTIVE",
      sortOrder: 1,
      createdAt: "2026-09-21T00:00:00.000Z",
      archivedAt: null,
      createdDay: "2026-09-21",
      archivedDay: null
    },
    {
      id: "habit-archived-1",
      name: "Archived Running",
      cadence: "TIMES_PER_WEEK",
      targetPerWeek: 3,
      status: "ARCHIVED",
      sortOrder: 2,
      createdAt: "2026-09-10T00:00:00.000Z",
      archivedAt: "2026-09-23T12:00:00.000Z",
      createdDay: "2026-09-10",
      archivedDay: "2026-09-23"
    }
  ],
  checkIns: [
    {
      id: "ci-1",
      habitId: "habit-active-1",
      date: "2026-09-26T00:00:00.000Z",
      day: "2026-09-26",
      done: true,
      amount: 15,
      note: "Morning routine complete"
    },
    {
      id: "ci-2",
      habitId: "habit-active-1",
      date: "2026-09-25T00:00:00.000Z",
      day: "2026-09-25",
      done: false,
      amount: null,
      note: null
    }
  ]
};

test.describe("Habit History & Backfill Dialog", () => {
  test("History header button is accessible even when active habit list is empty", async ({ page }) => {
    // Intercept /api/habits/history
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...mockHistoryData,
          habits: [],
          checkIns: []
        })
      });
    });

    await openToday(page);

    const historyBtn = page.getByRole("button", { name: "History" });
    await expect(historyBtn).toBeVisible();

    await historyBtn.click();
    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText("No habits found.")).toBeVisible();

    // Close dialog
    await page.getByRole("button", { name: "Close habit history" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(historyBtn).toBeFocused();
  });

  test("Renders eight-date buttons, date-first active habits, and distinct states", async ({ page }) => {
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryData)
      });
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    await expect(dialog).toBeVisible();

    // Verify exactly 8 date buttons in the date bar
    const dateBar = dialog.getByRole("region", { name: "Select history date" });
    const dateButtons = dateBar.locator("button.habit-history-date-btn");
    await expect(dateButtons).toHaveCount(8);

    // Today (2026-09-26) selected initially
    const todayBtn = dateButtons.last();
    await expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    await expect(todayBtn).toContainText("Today");

    // Habit rows for Today: habit-active-1 is Done (● Done), habit-active-2 is Unrecorded (· Not recorded)
    const row1 = dialog.locator('[data-habit="habit-active-1"]');
    await expect(row1.getByText("Morning Stretch")).toBeVisible();
    await expect(row1.locator(".habit-history-state-tag--done")).toContainText("Done");
    await expect(row1.getByText("Amount: 15")).toBeVisible();
    await expect(row1.getByText("“Morning routine complete”")).toBeVisible();

    const row2 = dialog.locator('[data-habit="habit-active-2"]');
    await expect(row2.getByText("Read 10 pages")).toBeVisible();
    await expect(row2.locator(".habit-history-state-tag--unrecorded")).toContainText("Not recorded");

    // Archived habit hidden by default
    await expect(dialog.getByText("Archived Running")).not.toBeVisible();

    // Toggle Show archived
    await dialog.getByLabel(/Show archived/).check();
    await expect(dialog.getByText("Archived Running")).toBeVisible();
    const archivedRow = dialog.locator('[data-habit="habit-archived-1"]');
    await expect(archivedRow.getByText("Archived")).toBeVisible();
    // On today (2026-09-26), habit-archived-1 is outside lifetime (archived on 2026-09-23)
    await expect(archivedRow.locator(".habit-history-state-tag--outOfScope")).toContainText("Outside lifetime");
  });

  test("Inline editor saves selected date with Done, zero amount, note, and serializes saves", async ({ page }) => {
    let capturedPutPayload: unknown = null;
    let capturedMutationId: string | null = null;

    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryData)
      });
    });

    await page.route("**/api/habits/*/check-in", async (route) => {
      if (route.request().method() === "PUT") {
        capturedPutPayload = route.request().postDataJSON();
        capturedMutationId = route.request().headers()["x-dayflow-mutation-id"] ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "ci-new",
            habitId: "habit-active-2",
            date: new Date(2026, 8, 23, 12).toISOString(),
            done: true,
            amount: 0,
            note: "Started reading"
          })
        });
      }
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });

    // Select date 2026-09-23 (fourth button)
    const dateButtons = dialog.locator("button.habit-history-date-btn");
    await dateButtons.nth(4).click();
    await expect(dialog.getByText("Viewing 2026-09-23")).toBeVisible();

    const habitRow = dialog.locator('[data-habit="habit-active-2"]');
    await habitRow.getByRole("button", { name: /Record/ }).click();

    // Inline editor is now visible
    const editor = habitRow.locator(".habit-history-editor");
    await expect(editor).toBeVisible();

    const saveBtn = editor.getByRole("button", { name: "Save" });
    // Save should be disabled until Done or Not done is selected
    await expect(saveBtn).toBeDisabled();

    // Click Done
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await expect(saveBtn).toBeEnabled();

    // Enter Amount 0 (must be preserved as 0, not coerced to null)
    await editor.getByPlaceholder("Amount (optional)").fill("0");

    // Enter Note
    await editor.getByPlaceholder("Note (optional)").fill("Started reading");

    // Click Save
    await saveBtn.click();

    // Verify PUT request payload and mutation ID
    expect(capturedPutPayload).toEqual({
      date: "2026-09-23",
      done: true,
      amount: 0,
      note: "Started reading"
    });
    expect(capturedMutationId).toBeTruthy();

    // Editor closes on confirmed save
    await expect(editor).not.toBeVisible();
  });

  test("Drafts are keyed and isolated across date switching", async ({ page }) => {
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryData)
      });
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const dateButtons = dialog.locator("button.habit-history-date-btn");

    // Switch to date 1 (2026-09-25)
    await dateButtons.nth(6).click();
    const habitRow = dialog.locator('[data-habit="habit-active-2"]');
    await habitRow.getByRole("button", { name: /Record/ }).click();

    // Type note draft on 2026-09-25
    await habitRow.locator('textarea[placeholder="Note (optional)"]').fill("Draft for September 25");

    // Switch to date 2 (2026-09-24)
    await dateButtons.nth(5).click();
    await expect(dialog.getByText("Viewing 2026-09-24")).toBeVisible();

    const noteOn24 = habitRow.locator('textarea[placeholder="Note (optional)"]');
    // Must NOT have leaked the draft from September 25
    await expect(noteOn24).toHaveValue("");

    // Switch back to date 1 (2026-09-25)
    await dateButtons.nth(6).click();
    await expect(dialog.getByText("Viewing 2026-09-25")).toBeVisible();
    // September 25 draft is preserved!
    await expect(habitRow.locator('textarea[placeholder="Note (optional)"]')).toHaveValue("Draft for September 25");
  });

  test("Warns before discarding unsaved edits when closing dialog", async ({ page }) => {
    await page.route("**/api/habits/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistoryData)
      });
    });

    await openToday(page);
    await page.getByRole("button", { name: "History" }).click();

    const dialog = page.getByRole("dialog", { name: "Habit history" });
    const habitRow = dialog.locator('[data-habit="habit-active-2"]');
    await habitRow.getByRole("button", { name: /Record/ }).click();

    // Touch amount
    await habitRow.locator('input[placeholder="Amount (optional)"]').fill("42");

    // Attempt to close dialog
    await page.getByRole("button", { name: "Close habit history" }).click();

    // Discard confirm alertdialog appears
    const confirmDialog = page.getByRole("alertdialog", { name: "Discard unsaved edits?" });
    await expect(confirmDialog).toBeVisible();

    // Click "Keep editing"
    await confirmDialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(dialog).toBeVisible();

    // Close again and choose "Discard and close"
    await page.getByRole("button", { name: "Close habit history" }).click();
    await confirmDialog.getByRole("button", { name: "Discard and close" }).click();
    await expect(dialog).not.toBeVisible();
  });
});
