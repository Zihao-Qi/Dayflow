import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resetTestDatabase, testDatabasePath } from "./database";
import { addLocalDays } from "./activity-date-helpers";

test.beforeEach(() => resetTestDatabase());

const habitEvidence = (page: Page) => page.getByRole("region", { name: "Habits", exact: true });
const habitRow = (page: Page, name: string) => habitEvidence(page).getByRole("article", {
  name: `${name} review summary`, exact: true
});

async function serverToday(page: Page) {
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  const { todayKey } = await response.json();
  expect(todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  return todayKey as string;
}

// This fixture goes into the suite's scratch database only. Historical definitions
// and evidence cannot all be created through today's eight-day write window.
function seedEvidence(today: string) {
  const day = (offset: number) => addLocalDays(today, offset);
  const timestamp = (offset: number) => new Date(`${day(offset)}T00:00:00`).getTime();
  const database = new DatabaseSync(testDatabasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    const insertHabit = database.prepare(`INSERT INTO "Habit"
      ("id", "name", "cadence", "targetPerWeek", "status", "sortOrder", "createdAt", "updatedAt", "archivedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertHabit.run("weekly", "Weekly practice", "TIMES_PER_WEEK", 3, "ACTIVE", 0, timestamp(-5), timestamp(0), null);
    insertHabit.run("daily", "Started today", "DAILY", 7, "ACTIVE", 1, timestamp(0), timestamp(0), null);
    insertHabit.run("earlier", "Earlier archived habit", "DAILY", 7, "ARCHIVED", 2, timestamp(-16), timestamp(-12), timestamp(-12));
    // Recorded on creation day (-10), backfilled four days (-14), then archived
    // on -8. This is a reachable pre-creation fact, even though the definition
    // had not existed by the historical Review Window's ending day (-13).
    insertHabit.run("before-creation", "Recorded before creation", "DAILY", 7, "ARCHIVED", 3, timestamp(-10), timestamp(-8), timestamp(-8));
    insertHabit.run("outside", "Outside both periods", "DAILY", 7, "ARCHIVED", 4, timestamp(-30), timestamp(-28), timestamp(-28));

    const insertCheckIn = database.prepare(`INSERT INTO "HabitCheckIn"
      ("id", "habitId", "date", "done", "amount", "note", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`);
    for (const offset of [-3, -2, -1, 0]) {
      insertCheckIn.run(`weekly-${offset}`, "weekly", timestamp(offset), 1, null, timestamp(0), timestamp(0));
    }
    insertCheckIn.run("weekly-false", "weekly", timestamp(-4), 0, 0, timestamp(0), timestamp(0));
    insertCheckIn.run("earlier-done", "earlier", timestamp(-14), 1, null, timestamp(-14), timestamp(-14));
    insertCheckIn.run("before-creation-false", "before-creation", timestamp(-14), 0, null, timestamp(-10), timestamp(-10));
    database.prepare(`INSERT INTO "Review"
      ("id", "periodStart", "periodEnd", "narrative", "nextPeriodIntention", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      "habit-past-review", timestamp(-9), timestamp(-2), "Saved Habit reflection", "Keep practising",
      timestamp(-3), timestamp(-3)
    );
  } finally {
    database.close();
  }
}

async function openReview(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await expect(page.getByRole("heading", {
    name: /(tasks? left|Nothing scheduled yet|All done for today)$/
  })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("What moved forward?")).toBeVisible();
  await expect(habitEvidence(page)).toBeVisible();
}

test("current Review shows an honest empty Habit evidence section", async ({ page }) => {
  await openReview(page);
  await expect(habitEvidence(page)).toContainText("No habits were active during this review period.");
  await expect(habitEvidence(page).getByRole("article")).toHaveCount(0);
  await expect(habitEvidence(page).getByRole("button")).toHaveCount(0);
});

test("current Review renders unclamped Habit evidence, four states and narrow layouts", async ({ page }) => {
  const today = await serverToday(page);
  seedEvidence(today);
  await openReview(page);
  const weekly = habitRow(page, "Weekly practice");
  await expect(weekly.getByLabel("4 of 3 completed", { exact: true })).toBeVisible();
  await expect(weekly).toContainText("3× per week");
  const expectedStates = [
    [-6, "Outside lifetime", "—"], [-5, "Not recorded", "·"],
    [-4, "Not done", "×"], [-3, "Done", "●"]
  ] as const;
  for (const [offset, state, mark] of expectedStates) {
    const date = addLocalDays(today, offset);
    const cell = weekly.getByTitle(new RegExp(`^${date}: ${state}`));
    await expect(cell).toBeVisible();
    await expect(cell).toContainText(mark);
    await expect(weekly.getByText(`${date}: ${state}`, { exact: true })).toHaveCount(1);
  }
  await expect(weekly.getByLabel(new RegExp(`${addLocalDays(today, -4)}: Not done, amount 0$`))).toBeVisible();
  await expect(weekly.getByRole("group").locator("[title]")).toHaveCount(7);
  await expect(habitRow(page, "Started today").getByLabel("0 of 1 completed", { exact: true })).toBeVisible();
  await expect(habitRow(page, "Earlier archived habit")).toHaveCount(0);
  await expect(habitRow(page, "Outside both periods")).toHaveCount(0);
  await expect(habitEvidence(page).getByRole("button")).toHaveCount(0);

  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    // The app applies breakpoint attributes from its resize handler; await the
    // destination mode before measuring the responsive result.
    await expect(page.locator("html")).toHaveAttribute("data-layout-mode", width < 620 ? "phone" : "desktop");
    const bounds = await habitEvidence(page).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: innerWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    const strip = weekly.getByRole("group");
    const contained = await strip.evaluate((element) => {
      const parent = element.getBoundingClientRect();
      return [...element.querySelectorAll("[title]")].every((cell) => {
        const rect = cell.getBoundingClientRect();
        return rect.left >= parent.left && rect.right <= parent.right + 1;
      });
    });
    expect(contained).toBe(true);
  }
});

test("historical Review Window shows archived and pre-creation evidence for its own interval", async ({ page }) => {
  const today = await serverToday(page);
  seedEvidence(today);
  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews", exact: true }).click();
  const panel = page.getByRole("region", { name: "Earlier reviews", exact: true });
  await panel.getByLabel("Review window ending").fill(addLocalDays(today, -13));
  await panel.getByRole("button", { name: "Open window", exact: true }).click();
  await expect(page.locator(".page-eyebrow")).toContainText("Review window");
  await expect(habitRow(page, "Earlier archived habit").getByLabel("1 of 4 completed", { exact: true })).toBeVisible();
  const beforeCreation = habitRow(page, "Recorded before creation");
  await expect(beforeCreation.getByLabel("0 of 1 completed", { exact: true })).toBeVisible();
  await expect(beforeCreation.getByTitle(`${addLocalDays(today, -14)}: Not done`, { exact: true })).toBeVisible();
  await expect(habitRow(page, "Weekly practice")).toHaveCount(0);
  await expect(habitRow(page, "Started today")).toHaveCount(0);
  await expect(habitRow(page, "Outside both periods")).toHaveCount(0);
  await expect(page.locator(".review-page textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save review", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to this week", exact: true }).click();
  await expect(habitRow(page, "Weekly practice").getByLabel("4 of 3 completed", { exact: true })).toBeVisible();
  await expect(habitRow(page, "Earlier archived habit")).toHaveCount(0);
  await expect(page.getByLabel("What moved forward?")).toBeVisible();

  // The history panel remains open after returning to current. A selected
  // empty interval must not fall back to the populated current one.
  await panel.getByLabel("Review window ending").fill(addLocalDays(today, -40));
  await panel.getByRole("button", { name: "Open window", exact: true }).click();
  await expect(page.locator(".page-eyebrow")).toContainText("Review window");
  await expect(habitEvidence(page)).toContainText("No habits were active during this review period.");
  await expect(habitEvidence(page).getByRole("article")).toHaveCount(0);
});

test("saved Past Review uses stored period Habit evidence and preserves its writing", async ({ page }) => {
  const today = await serverToday(page);
  seedEvidence(today);
  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews", exact: true }).click();
  await page.getByRole("region", { name: "Earlier reviews", exact: true })
    .getByRole("button", { name: /Saved Habit reflection/ }).click();
  await expect(page.locator(".page-eyebrow")).toContainText("Past review");
  const weekly = habitRow(page, "Weekly practice");
  await expect(weekly.getByLabel("1 of 3 completed", { exact: true })).toBeVisible();
  await expect(weekly.getByTitle(`${addLocalDays(today, -3)}: Done`, { exact: true })).toBeVisible();
  await expect(weekly.getByTitle(new RegExp(`^${today}:`))).toHaveCount(0);
  await expect(habitRow(page, "Started today")).toHaveCount(0);
  await expect(habitRow(page, "Recorded before creation").getByLabel("0 of 2 completed", { exact: true })).toBeVisible();
  await expect(page.locator(".review-past-card")).toContainText("Saved Habit reflection");
  await expect(page.locator(".review-past-card")).toContainText("Keep practising");
  await expect(page.locator(".review-page textarea")).toHaveCount(0);
  await expect(habitEvidence(page).getByRole("button")).toHaveCount(0);
});
