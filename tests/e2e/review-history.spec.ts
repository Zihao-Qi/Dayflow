import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, seedPastReviews } from "./database";
import { addLocalDays, localDateKey } from "./activity-date-helpers";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openReview(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review", exact: true, level: 1 })
  ).toBeVisible();
}

const historyPanel = (page: Page) =>
  page.getByRole("region", { name: "Earlier reviews" });

async function createActivityOn(page: Page, date: string, minutes: number) {
  const activity = await page.request.post("/api/activities", {
    data: {
      date,
      startTime: "12:00",
      durationMinutes: minutes,
      category: "Deep Work",
      note: `Review Window evidence for ${date}`
    }
  });
  expect(activity.status()).toBe(201);
}

async function openReviewWindow(page: Page, ending: string) {
  const panel = historyPanel(page);
  await panel.getByLabel("Review window ending").fill(ending);
  await panel.getByRole("button", { name: /Open window|Opening/ }).click();
  await expect(page.locator(".page-eyebrow")).toContainText("Review window");
}

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
  // Detail loading can outlast the DOM assertion timeout on a busy server.
  const pastReviewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/review/past-review-3" &&
      response.request().method() === "GET"
  );
  await historyPanel(page)
    .getByRole("button", { name: /Saved 3 days ago/ })
    .click();
  const pastReview = await pastReviewResponse;
  expect(pastReview.ok()).toBe(true);
  expect(await pastReview.finished()).toBeNull();

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

test("an unsaved Review Window opens derived evidence read-only and returns to this week", async ({
  page
}) => {
  const ending = addLocalDays(localDateKey(new Date()), -9);
  await createActivityOn(page, ending, 37);
  await openReview(page);
  const currentEyebrow = await page.locator(".page-eyebrow").textContent();

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await openReviewWindow(page, ending);

  await expect(page.locator(".review-metrics")).toContainText("37m");
  await expect(
    page.getByRole("heading", { name: "No review was saved for this window" })
  ).toBeVisible();
  await expect(page.locator(".review-page textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Save review$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to this week" }).click();
  await expect(page.locator(".page-eyebrow")).toHaveText(currentEyebrow ?? "");
  await expect(page.locator(".review-page textarea")).toHaveCount(2);
});

test("a Review Window shows a saved Review only at matching boundaries", async ({
  page
}) => {
  seedPastReviews([3]);
  const ending = addLocalDays(localDateKey(new Date()), -3);
  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await openReviewWindow(page, ending);

  const pastCard = page.locator(".review-past-card");
  await expect(pastCard.getByText("Saved 3 days ago")).toBeVisible();
  await expect(pastCard.getByText("Intention from 3 days ago")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No review was saved for this window" })
  ).toHaveCount(0);
});

test("Review Window selection is latest-wins and a failed request preserves the visible window", async ({
  page
}) => {
  const today = localDateKey(new Date());
  const slowEnding = addLocalDays(today, -9);
  const latestEnding = addLocalDays(today, -30);
  const failingEnding = addLocalDays(today, -40);
  await createActivityOn(page, slowEnding, 11);
  await createActivityOn(page, latestEnding, 22);

  let delaySlowRequest = true;
  let failRequest = true;
  await page.route("**/api/review/window?*", async (route) => {
    const ending = new URL(route.request().url()).searchParams.get("ending");
    if (ending === slowEnding && delaySlowRequest) {
      delaySlowRequest = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (ending === failingEnding && failRequest) {
      await route.fulfill({ status: 500, json: { error: "temporary" } });
      return;
    }
    await route.continue();
  });

  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews" }).click();
  const panel = historyPanel(page);
  await panel.getByLabel("Review window ending").fill(slowEnding);
  await panel.getByRole("button", { name: "Open window" }).click();
  await panel.getByLabel("Review window ending").fill(latestEnding);
  await panel.getByRole("button", { name: "Opening\u2026" }).click();
  await expect(page.locator(".review-metrics")).toContainText("22m");
  await page.waitForTimeout(650);
  await expect(page.locator(".review-metrics")).toContainText("22m");

  const latestEyebrow = await page.locator(".page-eyebrow").textContent();
  await panel.getByLabel("Review window ending").fill(failingEnding);
  await panel.getByRole("button", { name: "Open window" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Review Window could not be opened"
  );
  await expect(page.locator(".page-eyebrow")).toHaveText(latestEyebrow ?? "");
  await expect(page.locator(".review-metrics")).toContainText("22m");

  failRequest = false;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".review-metrics")).not.toContainText("22m");
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
  // Wait for this window's evidence before checking the resulting render.
  const pastReviewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/review/past-review-3" &&
      response.request().method() === "GET"
  );
  await historyPanel(page)
    .getByRole("button", { name: /Saved 3 days ago/ })
    .click();
  const pastReview = await pastReviewResponse;
  expect(pastReview.ok()).toBe(true);
  expect(await pastReview.finished()).toBeNull();

  await expect(page.locator(".page-eyebrow")).toContainText("Past review");
  await expect(page.locator(".review-metrics")).not.toContainText("45m");
});

test("Review history and a past period stay usable at phone width", async ({
  page
}) => {
  seedPastReviews([3, 10]);
  await page.setViewportSize({ width: 375, height: 812 });
  await openReview(page);

  await page.getByRole("button", { name: "Earlier reviews" }).click();
  const entry = historyPanel(page).getByRole("button", {
    name: /Saved 3 days ago/
  });
  await expect(entry).toBeVisible();

  // Touch targets stay reachable and the page never scrolls sideways.
  const box = await entry.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await entry.click();
  await expect(page.locator(".review-past-card")).toBeVisible();
  await expect(historyPanel(page).getByLabel("Review window ending")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    )
  ).toBe(false);
});

/**
 * Simulate the local day rolling over by shifting the period the bootstrap
 * payload reports, mirroring the existing Review rollover coverage.
 */
async function controlBootstrapPeriodShift(page: Page) {
  let bootstrapLoads = 0;
  let shiftPeriod = false;
  await page.route("**/api/bootstrap", async (route) => {
    const shouldShift = shiftPeriod;
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown> & {
      review: Record<string, unknown> & {
        periodStart: string;
        periodEnd: string;
      };
    };
    bootstrapLoads += 1;
    if (shouldShift) {
      payload.today = shiftLocalDay(payload.today as string);
      payload.review = {
        id: null,
        periodStart: shiftLocalDay(payload.review.periodStart),
        periodEnd: shiftLocalDay(payload.review.periodEnd),
        narrative: "",
        nextPeriodIntention: "",
        persisted: false
      };
    }
    await route.fulfill({ response, json: payload });
  });
  return {
    armShift: () => {
      shiftPeriod = true;
    },
    loadCount: () => bootstrapLoads
  };
}

function shiftLocalDay(value: string) {
  return new Date(new Date(value).getTime() + 24 * 60 * 60 * 1_000).toISOString();
}

test("a local-day rollover keeps an open Past Review Period on screen", async ({
  page
}) => {
  seedPastReviews([3]);
  const bootstrapPeriod = await controlBootstrapPeriodShift(page);

  const now = new Date();
  const loadingTime = new Date(now);
  loadingTime.setHours(23, 55, 0, 0);
  const lateToday = new Date(now);
  lateToday.setHours(23, 59, 59, 0);
  await page.clock.install({ time: loadingTime });

  await openReview(page);
  await page.getByRole("button", { name: "Earlier reviews" }).click();
  await historyPanel(page)
    .getByRole("button", { name: /Saved 3 days ago/ })
    .click();

  const pastCard = page.locator(".review-past-card");
  await expect(pastCard).toBeVisible();
  const pastEyebrow = await page.locator(".page-eyebrow").textContent();

  const loadsBeforeRollover = bootstrapPeriod.loadCount();
  bootstrapPeriod.armShift();
  await page.clock.pauseAt(lateToday);
  await page.clock.runFor(1_500);
  await expect
    .poll(bootstrapPeriod.loadCount)
    .toBeGreaterThan(loadsBeforeRollover);

  // The past window is absolute, so the rollover must not move it or discard
  // the reader's place in history.
  await expect(pastCard).toBeVisible();
  await expect(page.locator(".page-eyebrow")).toHaveText(pastEyebrow ?? "");
  await expect(page.locator(".review-page textarea")).toHaveCount(0);
});
