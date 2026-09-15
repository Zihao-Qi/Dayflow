import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

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

const habitsCard = (page: Page) => page.getByRole("region", { name: "Habits" });

async function createHabit(page: Page, name: string) {
  const created = await page.request.post("/api/habits", { data: { name } });
  expect(created.ok(), await created.text()).toBe(true);
  return created.json();
}

test("a Check-in recorded from Today survives a reload", async ({ page }) => {
  await createHabit(page, "Morning stretch");
  await openToday(page);

  const toggle = habitsCard(page).getByRole("button", { name: /Morning stretch/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("not recorded today");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("done today");

  // The state has to come back from storage, not from component memory.
  await page.reload();
  const afterReload = habitsCard(page).getByRole("button", { name: /Morning stretch/ });
  await expect(afterReload).toHaveAttribute("aria-pressed", "true");
  await expect(afterReload).toContainText("done today");
});

test("an unrecorded Habit reads differently from one recorded as not done", async ({ page }) => {
  // The storage model keeps these apart, so the page must not collapse them.
  const habit = await createHabit(page, "Evening walk");
  await createHabit(page, "Never touched");

  const recorded = await page.request.put(
    `/api/habits/${habit.id}/check-in`,
    { data: { done: false } }
  );
  expect(recorded.ok(), await recorded.text()).toBe(true);

  await openToday(page);
  const card = habitsCard(page);
  await expect(card.getByRole("button", { name: /Evening walk/ })).toContainText(
    "not done today"
  );
  await expect(card.getByRole("button", { name: /Never touched/ })).toContainText(
    "not recorded today"
  );
});

test("the first Habit is created from the card itself", async ({ page }) => {
  // The card renders with no Habits on purpose: it is the only place to make
  // the first one. Hiding it when empty left the feature unreachable.
  await openToday(page);
  const card = habitsCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("No habits yet");

  await card.getByLabel("New habit name").fill("Morning stretch");
  await card.getByRole("button", { name: "Add habit" }).click();

  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
  await expect(card).not.toContainText("No habits yet");

  // It has to be stored, not just rendered.
  await page.reload();
  await expect(
    habitsCard(page).getByRole("button", { name: /Morning stretch/ })
  ).toBeVisible();
});

test("retries an unconfirmed Habit create with the same mutation ID and retires it on success", async ({
  page
}) => {
  await openToday(page);
  const card = habitsCard(page);

  const mutationIds: string[] = [];
  let hideFirstSuccess = true;

  await page.route("**/api/habits", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const mutationId = (await request.headerValue("X-Dayflow-Mutation-Id")) ?? "";
    mutationIds.push(mutationId);

    if (hideFirstSuccess) {
      hideFirstSuccess = false;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary network failure." })
      });
      return;
    }
    await route.continue();
  });

  const input = card.getByLabel("New habit name");
  const addButton = card.getByRole("button", { name: "Add habit" });

  await input.fill("Morning stretch");
  await addButton.click();

  // Failed create keeps draft in input and displays error
  await expect(input).toHaveValue("Morning stretch");
  await expect(page.locator(".sr-only[role='status']")).toHaveText("Habit status unconfirmed. Your draft is still here.");

  // Retry with same draft
  await addButton.click();

  // Wait for button to be visible and input cleared
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
  await expect(input).toHaveValue("");
  expect(mutationIds.length).toBe(2);
  expect(mutationIds[0]).toBeTruthy();
  expect(mutationIds[1]).toBe(mutationIds[0]);

  // Deliberate subsequent create with the SAME name gets a new mutation ID
  await input.fill("Morning stretch");
  await addButton.click();

  await expect(card.getByRole("button", { name: /Morning stretch/ })).toHaveCount(2);
  expect(mutationIds.length).toBe(3);
  expect(mutationIds[2]).toBeTruthy();
  expect(mutationIds[2]).not.toBe(mutationIds[0]);

  // Verify DB has exactly 2 distinct habits, not 1 or 3 (retry was idempotent, retirement enabled 2nd creation)
  await page.reload();
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toHaveCount(2);
});

test("separates confirmed write success from read-refresh failure", async ({ page }) => {
  let habitCreateRequests = 0;
  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "POST") habitCreateRequests += 1;
    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);

  let failRefresh = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (failRefresh) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Read refresh offline." })
      });
      return;
    }
    await route.continue();
  });

  const input = card.getByLabel("New habit name");
  const addButton = card.getByRole("button", { name: "Add habit" });

  await input.fill("Morning stretch");
  failRefresh = true;

  await addButton.click();

  // The habit remains visible in the list because write succeeded
  const habitButton = card.getByRole("button", { name: /Morning stretch/ });
  await expect(habitButton).toBeVisible();
  // Coherent display: not recorded today, canonical target 1 (not fabricated target 7 with 0 days)
  await expect(habitButton).toContainText("not recorded today");
  await expect(card.getByText("0 of 1 this period")).toBeVisible();
  // The draft was cleared on confirmed write
  await expect(input).toHaveValue("");
  // Truthful saved-but-refresh-failed feedback
  const toast = page.locator(".app-error-toast");
  await expect(toast).toContainText("Your change was saved, but Dayflow could not refresh the latest view.");
  const retryButton = toast.getByRole("button", { name: "Retry refresh" });
  await expect(retryButton).toBeVisible();

  // Recover read refresh and click Retry refresh (no page.reload!)
  failRefresh = false;
  await retryButton.click();

  // Read error is resolved and toast is dismissed
  await expect(toast).toHaveCount(0);
  // Fresh content is visible and preserved
  await expect(habitButton).toBeVisible();
  // Only a single write request was sent
  expect(habitCreateRequests).toBe(1);
});

test("tracks independent busy states across simultaneous habit check-ins", async ({ page }) => {
  const habitA = await createHabit(page, "Morning stretch");
  const habitB = await createHabit(page, "Evening walk");

  let resolveA: () => void = () => {};
  const gateA = new Promise<void>((r) => { resolveA = r; });
  let resolveB: () => void = () => {};
  const gateB = new Promise<void>((r) => { resolveB = r; });

  await page.route("**/api/habits/*/check-in", async (route) => {
    const url = route.request().url();
    if (url.includes(habitA.id)) {
      await gateA;
      await route.continue();
      return;
    }
    if (url.includes(habitB.id)) {
      await gateB;
      await route.continue();
      return;
    }
    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);

  const buttonA = card.getByRole("button", { name: /Morning stretch/ });
  const buttonB = card.getByRole("button", { name: /Evening walk/ });

  await expect(buttonA).toBeEnabled();
  await expect(buttonB).toBeEnabled();

  // Start action on A
  await buttonA.click();
  await expect(buttonA).toBeDisabled();
  await expect(buttonB).toBeEnabled();

  // Start action on B while A is still pending
  await buttonB.click();
  await expect(buttonA).toBeDisabled();
  await expect(buttonB).toBeDisabled();

  // Complete B first
  resolveB();
  await expect(buttonB).toBeEnabled();
  // A must still be disabled, not prematurely re-enabled by B's completion
  await expect(buttonA).toBeDisabled();

  // Complete A
  resolveA();
  await expect(buttonA).toBeEnabled();
});

test("delayed check-in does not mark a new day done after calendar rollover", async ({ page }) => {
  await createHabit(page, "Morning stretch");

  const now = new Date();
  const loadingTime = new Date(now);
  loadingTime.setHours(23, 55, 0, 0);
  const lateToday = new Date(now);
  lateToday.setHours(23, 59, 59, 0);
  await page.clock.install({ time: loadingTime });

  let releaseCheckIn: () => void = () => {};
  const checkInGate = new Promise<void>((resolve) => { releaseCheckIn = resolve; });

  let failTrailingRefresh = false;
  let shiftToNewDay = false;

  await page.route("**/api/habits/*/check-in", async (route) => {
    await checkInGate;
    await route.continue();
  });

  await page.route("**/api/bootstrap", async (route) => {
    if (failTrailingRefresh) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Trailing refresh offline." })
      });
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    if (shiftToNewDay) {
      const currentToday = new Date(payload.today);
      const nextDay = new Date(currentToday);
      nextDay.setDate(nextDay.getDate() + 1);
      payload.today = nextDay.toISOString();
      payload.todayKey = nextDay.toISOString().slice(0, 10);
      if (Array.isArray(payload.habits)) {
        payload.habits = payload.habits.map((h: Record<string, unknown>) => ({
          ...h,
          today: null
        }));
      }
    }
    await route.fulfill({ response, json: payload });
  });

  await openToday(page);
  const card = habitsCard(page);
  const button = card.getByRole("button", { name: /Morning stretch/ });
  await expect(button).toContainText("not recorded today");

  // Trigger check-in for Day 1; it pauses at checkInGate
  await button.click();
  await expect(button).toBeDisabled();

  // While check-in is pending in flight, advance clock across midnight to publish new-day read (Day 2)
  const newDayResponse = page.waitForResponse(
    (res) => res.url().includes("/api/bootstrap") && res.status() === 200
  );
  shiftToNewDay = true;
  await page.clock.pauseAt(lateToday);
  await page.clock.runFor(1_500);
  await newDayResponse;

  // Set trailing refresh to fail
  failTrailingRefresh = true;

  // Release the pending old-day check-in response
  releaseCheckIn();

  // The button re-enables after check-in completes
  await expect(button).toBeEnabled();

  // Under rollover protection, yesterday's check-in must NOT mark today done!
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toContainText("not recorded today");
});
