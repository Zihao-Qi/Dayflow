import { tourDestinationsAndReturn } from "./destination-tour";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  setFocusSessionElapsedMinutes
} from "./database";

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

function metric(scope: Locator, label: string) {
  return scope.locator(":scope > div").filter({ hasText: label });
}

function displayedMinutes(value: string) {
  const hours = /(\d+)h/.exec(value)?.[1];
  const minutes = /(\d+)m/.exec(value)?.[1];
  return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
}

test("shows a complete current-period evidence summary", async ({ page }) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Review evidence Project" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };

  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Complete the evidence review",
      date: null,
      status: "DONE",
      projectId: project.id
    }
  });
  expect(taskResponse.status()).toBe(201);

  for (const activity of [
    {
      durationMinutes: 35,
      note: "Prepared the weekly evidence",
      category: "Deep Work",
      projectId: project.id
    },
    {
      durationMinutes: 30,
      note: "Learned from the weekly evidence",
      category: "Learning",
      projectId: project.id
    }
  ]) {
    const response = await page.request.post("/api/activities", {
      data: activity
    });
    expect(response.status()).toBe(201);
  }

  const focusResponse = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Review focus",
      projectId: project.id
    }
  });
  expect(focusResponse.status()).toBe(201);
  const { session } = (await focusResponse.json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 25);
  const completeFocus = await page.request.patch(
    `/api/focus-session/${session.id}`,
    { data: { action: "complete" } }
  );
  expect(completeFocus.ok()).toBe(true);

  const noteResponse = await page.request.post("/api/notes", {
    data: {
      content: "The evidence points to consistent progress.",
      projectId: project.id
    }
  });
  expect(noteResponse.status()).toBe(201);

  const materialResponse = await page.request.post("/api/materials", {
    data: {
      title: "Weekly review reference",
      url: "https://example.com/weekly-review",
      projectId: project.id
    }
  });
  expect(materialResponse.status()).toBe(201);

  const diaryResponse = await page.request.put("/api/diary", {
    data: {
      content: "A grounded day.",
      reflection: "Protect time for the work that matters.",
      mood: 4,
      energy: 2
    }
  });
  expect(diaryResponse.ok()).toBe(true);

  await openReview(page);

  const totals = page.getByLabel("Review period totals");
  await expect(metric(totals, "Recorded")).toContainText("1h 30m");
  await expect(metric(totals, "Focused")).toContainText("25m");
  await expect(metric(totals, "Tasks done")).toContainText("1");
  await expect(metric(totals, "Diary days")).toContainText("1/7");

  const evidence = page.getByRole("region", {
    name: "Evidence captured",
    exact: true
  });
  await expect(
    metric(evidence.locator(".review-evidence-counts"), "Notes")
  ).toContainText("1");
  await expect(
    metric(evidence.locator(".review-evidence-counts"), "References")
  ).toContainText("1");
  await expect(
    metric(evidence.locator(".review-evidence-counts"), "Projects")
  ).toContainText("1");
  await expect(
    metric(evidence.locator(".review-evidence-counts"), "Average mood")
  ).toContainText("4/5");
  await expect(
    metric(evidence.locator(".review-evidence-counts"), "Average energy")
  ).toContainText("2/5");
  await expect(evidence).toContainText("across 1 saved Diary day");

  const categories = page.getByRole("list", {
    name: "Activity time by category"
  });
  const categoryRows = categories.getByRole("listitem");
  await expect(categoryRows.locator(".review-category-copy > span")).toHaveText([
    "Deep Work",
    "Learning"
  ]);
  await expect(
    categoryRows.locator(".review-category-copy > strong")
  ).toHaveText(["1h", "30m"]);
  const categoryDurations = await categoryRows
    .locator(".review-category-copy > strong")
    .allTextContents();
  expect(
    categoryDurations.reduce(
      (sum, value) => sum + displayedMinutes(value),
      0
    )
  ).toBe(90);
  await expect(
    page
      .getByRole("region", { name: "Where the time went", exact: true })
      .locator(".review-panel-heading > strong")
  ).toHaveText("1h 30m");

  const movedProjects = page.getByRole("region", {
    name: "Projects moved forward",
    exact: true
  });
  const movedProject = movedProjects.getByRole("button", {
    name: /Review evidence Project/
  });
  await expect(movedProject).toBeVisible();
  await expect(movedProject).toContainText(
    "1/1 tasks · 1h 30m invested this review period"
  );
});

test("treats a malformed 2xx save as failed and preserves both drafts", async ({
  page
}) => {
  await openReview(page);

  let saveAttempts = 0;
  await page.route("**/api/review", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    saveAttempts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "malformed-success" })
    });
  });

  const narrative = "Made steady progress on the weekly evidence.";
  const intention = "Protect two uninterrupted focus blocks.";
  const narrativeField = page.getByLabel("What moved forward?");
  const intentionField = page.getByLabel("What deserves protection next?");
  await narrativeField.fill(narrative);
  await intentionField.fill(intention);
  await page.getByRole("button", { name: "Save review", exact: true }).click();

  const reviewEditor = page.getByRole("region", {
    name: "Your review",
    exact: true
  });
  const saveState = reviewEditor.getByRole("status");
  await expect(saveState).toContainText("Not saved", { timeout: 12_000 });
  await expect(
    saveState.getByRole("button", { name: "Retry", exact: true })
  ).toBeVisible();
  await expect(narrativeField).toHaveValue(narrative);
  await expect(intentionField).toHaveValue(intention);
  expect(saveAttempts).toBeGreaterThanOrEqual(3);
});

test("starts a fresh Review when the local day changes", async ({ page }) => {
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  expect(bootstrapResponse.ok()).toBe(true);
  const current = (await bootstrapResponse.json()) as {
    today: string;
    review: {
      periodStart: string;
      periodEnd: string;
    };
  };
  const savedResponse = await page.request.put("/api/review", {
    data: {
      periodStart: current.review.periodStart,
      periodEnd: current.review.periodEnd,
      narrative: "This belongs to the ending period.",
      nextPeriodIntention: "Keep the boundary honest."
    }
  });
  expect(savedResponse.ok()).toBe(true);

  const bootstrapPeriod = await controlBootstrapPeriodShift(page);

  const loadingTime = new Date(current.today);
  loadingTime.setHours(23, 55, 0, 0);
  const lateToday = new Date(current.today);
  lateToday.setHours(23, 59, 59, 0);
  await page.clock.install({ time: loadingTime });
  await openReview(page);

  const narrative = page.getByLabel("What moved forward?");
  const intention = page.getByLabel("What deserves protection next?");
  await expect(narrative).toHaveValue("This belongs to the ending period.");
  await expect(intention).toHaveValue("Keep the boundary honest.");
  const periodLabel = page.getByText(/^Seven days ending /);
  const endingBefore = await periodLabel.textContent();

  const loadsBeforeRollover = bootstrapPeriod.loadCount();
  bootstrapPeriod.armShift();
  await page.clock.pauseAt(lateToday);
  await page.clock.runFor(1_500);

  await expect
    .poll(bootstrapPeriod.loadCount)
    .toBeGreaterThan(loadsBeforeRollover);
  await expect(narrative).toHaveValue("");
  await expect(intention).toHaveValue("");
  await expect(periodLabel).not.toHaveText(endingBefore ?? "");
});

test("loads the fresh Review after a stale-period save response", async ({
  page
}) => {
  const bootstrapPeriod = await controlBootstrapPeriodShift(page);
  let saveAttempts = 0;
  await page.route("**/api/review", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    saveAttempts += 1;
    await route.fulfill({
      status: 409,
      json: {
        error: "The Review Period changed. Refresh and try again.",
        code: "REVIEW_PERIOD_CHANGED",
        field: "reviewPeriod"
      }
    });
  });
  await openReview(page);

  const periodLabel = page.getByText(/^Seven days ending /);
  const endingBefore = await periodLabel.textContent();
  const narrative = page.getByLabel("What moved forward?");
  const intention = page.getByLabel("What deserves protection next?");
  await narrative.fill("Do not carry this draft into a different period.");
  const loadsBeforeSave = bootstrapPeriod.loadCount();
  bootstrapPeriod.armShift();
  await page.getByRole("button", { name: "Save review", exact: true }).click();

  await expect
    .poll(bootstrapPeriod.loadCount)
    .toBeGreaterThan(loadsBeforeSave);
  await expect(narrative).toHaveValue("");
  await expect(intention).toHaveValue("");
  await expect(periodLabel).not.toHaveText(endingBefore ?? "");
  await expect(
    page.getByText(
      "The Review Period changed. A fresh Review is ready.",
      { exact: true }
    )
  ).toBeVisible();
  expect(saveAttempts).toBe(1);
});

test("keeps the Review editor usable without horizontal overflow", async ({
  page
}) => {
  await openReview(page);

  for (const viewport of [
    { width: 390, mode: "phone" },
    { width: 900, mode: "compact" },
    { width: 1280, mode: "desktop" }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: 900 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-layout-mode",
      viewport.mode
    );

    await expect(page.getByLabel("What moved forward?")).toBeVisible();
    await expect(
      page.getByLabel("What deserves protection next?")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save review", exact: true })
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth
      )
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth + 1
    );
  }
});

function shiftLocalDay(value: string) {
  const shifted = new Date(value);
  shifted.setDate(shifted.getDate() + 1);
  return shifted.toISOString();
}

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

// Review owns its editor/history locally: saved writing survives a tour, while
// the earlier-review panel remounts closed. Do not lift that state in extraction.
test("Review keeps saved writing and resets its history panel across the destination tour", async ({ page }) => {
  await openReview(page);
  await page.locator("#review-narrative").fill("Review shell parity");
  await page.locator("#review-intention").fill("Keep the current lifetime");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.locator(".review-page").getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Earlier reviews", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide earlier reviews", exact: true })).toBeVisible();
  await tourDestinationsAndReturn(page, "review");
  await expect(page.locator("#review-narrative")).toHaveValue("Review shell parity");
  await expect(page.locator("#review-intention")).toHaveValue("Keep the current lifetime");
  await expect(page.getByRole("button", { name: "Earlier reviews", exact: true })).toHaveAttribute("aria-expanded", "false");
});
