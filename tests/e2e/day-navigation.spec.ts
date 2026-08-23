import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openLog(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /blocks? left$/ })).toBeVisible({
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

  await page.getByRole("button", { name: /^Projects/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true, level: 1 })
  ).toBeVisible();
  await page.getByRole("button", { name: "Log", exact: true }).click();

  await expect(dayInput(page)).toHaveValue(today);
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
