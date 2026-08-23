import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, seedPastReviews } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openReview(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /blocks? left$/ })).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review", exact: true, level: 1 })
  ).toBeVisible();
}

const historyPanel = (page: Page) =>
  page.getByRole("region", { name: "Earlier reviews" });

test("history reaches Reviews saved any number of days ago", async ({ page }) => {
  // 7 and 14 sit on a seven-day grid anchored at today; 3 and 9 deliberately
  // do not. All four must be listed.
  seedPastReviews([3, 7, 9, 14]);
  await openReview(page);

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  const panel = historyPanel(page);
  await expect(panel).toBeVisible();

  for (const daysAgo of [3, 7, 9, 14]) {
    await expect(
      panel.getByRole("button", { name: new RegExp(`Saved ${daysAgo} days ago`) })
    ).toBeVisible();
  }
});

test("a past period opens read-only and returns to an editable current period", async ({
  page
}) => {
  seedPastReviews([3]);
  await openReview(page);

  // The current period is editable to begin with.
  await expect(page.getByRole("button", { name: /^Save review$/ })).toBeVisible();
  const currentEyebrow = await page.locator(".page-eyebrow").textContent();

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await historyPanel(page)
    .getByRole("button", { name: /Saved 3 days ago/ })
    .click();

  // Read-only: the saved writing is shown, with nothing to type into and
  // nothing to save.
  await expect(page.locator(".page-eyebrow")).toContainText("Past review");
  const pastCard = page.locator(".review-past-card");
  await expect(pastCard.getByText("Saved 3 days ago")).toBeVisible();
  await expect(pastCard.getByText("Intention from 3 days ago")).toBeVisible();
  await expect(page.locator(".review-page textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Save review$/ })).toHaveCount(0);

  // Returning restores the editable current period exactly.
  await page.getByRole("button", { name: "Back to this week" }).click();
  await expect(page.locator(".page-eyebrow")).toHaveText(currentEyebrow ?? "");
  await expect(page.locator(".review-page textarea")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Save review$/ })).toBeVisible();
});

test("a workspace with no earlier Review says so honestly", async ({ page }) => {
  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await expect(
    historyPanel(page).getByText("No earlier review has been saved yet.")
  ).toBeVisible();
});

test("a Review saved for the current period stays out of history", async ({
  page
}) => {
  await openReview(page);

  await page
    .getByRole("textbox", { name: "What moved forward?" })
    .fill("Written for the period that is still open.");
  await page.getByRole("button", { name: /^Save review$/ }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await expect(
    historyPanel(page).getByText("No earlier review has been saved yet.")
  ).toBeVisible();
});

test("past-period evidence is derived for that window, not for today", async ({
  page
}) => {
  seedPastReviews([3]);

  // Recorded today, so it belongs to the current period only.
  const activity = await page.request.post("/api/activities", {
    data: {
      startedAt: new Date().toISOString(),
      durationMinutes: 45,
      category: "Deep Work",
      note: "today only"
    }
  });
  expect(activity.status()).toBe(201);

  await openReview(page);
  await expect(page.locator(".review-metrics")).toContainText("45m");

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await historyPanel(page)
    .getByRole("button", { name: /Saved 3 days ago/ })
    .click();

  await expect(page.locator(".page-eyebrow")).toContainText("Past review");
  await expect(page.locator(".review-metrics")).not.toContainText("45m");
});
