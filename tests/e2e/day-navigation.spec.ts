import { tourDestinationsAndReturn } from "./destination-tour";
import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, seedTimeBlock } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openLog(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Log", exact: true, level: 1 })
  ).toBeVisible();
}

const picker = (page: Page) => page.getByRole("group", { name: "Choose a day" });
const dayInput = (page: Page) => page.getByLabel("Day shown in Log");
const eyebrow = (page: Page) => page.locator(".page-eyebrow");

function offsetKey(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

async function todayKey(page: Page) {
  const bootstrap = await page.request.get("/api/bootstrap");
  return String((await bootstrap.json()).todayKey);
}

test("Log opens on today and offers no way back until you leave it", async ({ page }) => {
  await openLog(page);
  const today = await todayKey(page);
  await expect(picker(page)).toBeVisible();
  await expect(dayInput(page)).toHaveValue(today);
  await expect(page.getByRole("button", { name: "Back to today" })).toHaveCount(0);
});

test("a future day plans without inventing evidence", async ({ page }) => {
  await openLog(page);
  const today = await todayKey(page);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(dayInput(page)).toHaveValue(offsetKey(today, 1));
  await expect(eyebrow(page)).toContainText("Planning");

  // Absence is stated, never shown as a zero measurement.
  const totals = page.locator(".log-totals");
  await expect(totals).toContainText("planned");
  await expect(totals).toContainText("this day has not happened");
  // The point is that absence is stated, not shown as a measurement. The
  // honest copy does contain the word "recorded", so ban the zero instead.
  await expect(totals).not.toContainText("0m recorded");
  await expect(totals).not.toContainText("so far today");

  // Planning is offered; recording is not.
  await expect(page.getByRole("button", { name: /Add time block/ })).toBeVisible();
  await expect(page.locator(".stream-activity-edit")).toHaveCount(0);
});

test("a past day reads and corrects but cannot be planned into", async ({ page }) => {
  const today = await todayKey(page);
  seedTimeBlock({
    id: "past-navigation-block",
    date: offsetKey(today, -1),
    title: "Past navigation evidence"
  });
  await openLog(page);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(eyebrow(page)).toContainText("Looking back");
  await expect(page.getByRole("button", { name: /Add time block/ })).toHaveCount(0);
});

test("returning to today restores today's behaviour", async ({ page }) => {
  await openLog(page);
  const today = await todayKey(page);
  const todayEyebrow = await eyebrow(page).textContent();

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(dayInput(page)).toHaveValue(offsetKey(today, 1));

  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(dayInput(page)).toHaveValue(today);
  await expect(eyebrow(page)).toHaveText(todayEyebrow ?? "");
  await expect(page.getByRole("button", { name: /Add time block/ })).toBeVisible();
});

test("leaving Log and returning resets the day", async ({ page }) => {
  await openLog(page);
  const today = await todayKey(page);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(dayInput(page)).toHaveValue(offsetKey(today, 1));

  await tourDestinationsAndReturn(page, "day");

  await expect(dayInput(page)).toHaveValue(today);
  await expect(page.getByRole("radio", { name: "Stream", exact: true })).toBeChecked();
});

test("forward navigation stops at the eight-week horizon", async ({ page }) => {
  await openLog(page);
  const today = await todayKey(page);
  const horizon = offsetKey(today, 8 * 7);

  await dayInput(page).fill(horizon);
  await expect(dayInput(page)).toHaveValue(horizon);
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();

  // The route refuses beyond it rather than quietly showing a nearer day.
  const beyond = await page.request.get(
    `/api/day?date=${offsetKey(today, 8 * 7 + 1)}`
  );
  expect(beyond.status()).toBe(400);
  expect(await beyond.json()).toMatchObject({
    code: "VALIDATION_ERROR",
    field: "date"
  });
});

test("a planned future block survives navigating away and back", async ({ page }) => {
  const today = await todayKey(page);
  const tomorrow = offsetKey(today, 1);
  const created = await page.request.post("/api/time-blocks", {
    data: {
      date: tomorrow,
      startTime: "09:00",
      endTime: "10:00",
      title: "Deep work tomorrow",
      taskId: null
    }
  });
  expect(created.status()).toBe(201);

  await openLog(page);
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(dayInput(page)).toHaveValue(tomorrow);
  await expect(page.getByText("Deep work tomorrow")).toBeVisible();
});

test("creating a future Time Block writes to the Viewed Day and refreshes it", async ({
  page
}) => {
  await openLog(page);
  const today = await todayKey(page);
  const tomorrow = offsetKey(today, 1);

  await page.getByRole("button", { name: "Next day" }).click();
  await page
    .getByRole("button", { name: "Add time block", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add time block",
    exact: true
  });
  await dialog.getByLabel("Title", { exact: true }).fill("Plan tomorrow");
  await dialog.getByLabel("Start", { exact: true }).fill("11:00");
  await dialog.getByLabel("End", { exact: true }).fill("12:00");

  const requestPromise = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/time-blocks" &&
      request.method() === "POST"
  );
  await dialog.getByRole("button", { name: "Add block" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({ date: tomorrow });
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Time block: Plan tomorrow, 11:00 to 12:00",
      exact: true
    })
  ).toBeVisible();
});

test("a past Time Block remains editable as a correction", async ({ page }) => {
  const today = await todayKey(page);
  const yesterday = offsetKey(today, -1);
  seedTimeBlock({
    id: "past-editable-block",
    date: yesterday,
    title: "Original past plan"
  });

  await openLog(page);
  await dayInput(page).fill(yesterday);
  await page.getByRole("radio", { name: "Timeline", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Time block: Original past plan, 09:00 to 10:00",
      exact: true
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Edit time block",
    exact: true
  });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Corrected past plan");
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/api/time-blocks/past-editable-block" &&
      response.request().method() === "PUT"
  );
  await dialog.getByRole("button", { name: "Save changes" }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Time block: Corrected past plan, 09:00 to 10:00",
      exact: true
    })
  ).toBeVisible();
});

test("Time Block corrections cannot move a block into another past day", async ({
  page
}) => {
  const today = await todayKey(page);
  const yesterday = offsetKey(today, -1);
  const twoDaysAgo = offsetKey(today, -2);
  seedTimeBlock({
    id: "current-block-date-guard",
    date: today,
    title: "Current block"
  });
  seedTimeBlock({
    id: "past-block-date-guard",
    date: yesterday,
    title: "Past block",
    startTime: "13:00",
    endTime: "14:00"
  });

  for (const [id, date] of [
    ["current-block-date-guard", yesterday],
    ["past-block-date-guard", twoDaysAgo]
  ]) {
    const response = await page.request.put(`/api/time-blocks/${id}`, {
      data: {
        date,
        startTime: "09:00",
        endTime: "10:00",
        title: "Illicit past move",
        taskId: null
      }
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "date"
    });
  }

  const correction = await page.request.put(
    "/api/time-blocks/past-block-date-guard",
    {
      data: {
        date: yesterday,
        startTime: "09:00",
        endTime: "10:00",
        title: "Corrected in place",
        taskId: null
      }
    }
  );
  expect(correction.status()).toBe(200);
  expect(await correction.json()).toMatchObject({
    date: yesterday,
    title: "Corrected in place"
  });
});

test("non-today Stream views expose no Focus, queue, or capture actions", async ({
  page
}) => {
  const today = await todayKey(page);
  const yesterday = offsetKey(today, -1);
  const tomorrow = offsetKey(today, 1);
  for (const [title, date] of [
    ["Past task", yesterday],
    ["Future task", tomorrow]
  ]) {
    const response = await page.request.post("/api/tasks", {
      data: { title, date, estimateMinutes: 30 }
    });
    expect(response.status()).toBe(201);
  }

  await openLog(page);
  for (const date of [yesterday, tomorrow]) {
    await dayInput(page).fill(date);
    await page.getByRole("radio", { name: "Stream", exact: true }).click();
    const stream = page.locator(".day-stream");
    await expect(stream).toBeVisible();
    await expect(
      stream.getByRole("button", {
        name: /Start this block|Focus|Queue|Add to the day/
      })
    ).toHaveCount(0);
  }
});

test("the day route rejects dates before the earliest persisted Evidence", async ({
  page
}) => {
  const today = await todayKey(page);
  const earliest = offsetKey(today, -2);
  seedTimeBlock({
    id: "earliest-navigation-block",
    date: earliest,
    title: "Earliest evidence"
  });

  const response = await page.request.get(
    `/api/day?date=${offsetKey(earliest, -1)}`
  );
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "VALIDATION_ERROR",
    field: "date"
  });
});

test("the day picker fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openLog(page);

  const next = page.getByRole("button", { name: "Next day" });
  const box = await next.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(eyebrow(page)).toContainText("Planning");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    )
  ).toBe(false);
});
