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
  await expect(page.locator(".sr-only[role='status']")).toHaveText("Habit was not saved.");

  // Retry with same draft
  await addButton.click();

  // Wait for button to be visible and input cleared
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
  await expect(input).toHaveValue("");
  expect(mutationIds.length).toBe(2);
  expect(mutationIds[0]).toBeTruthy();
  expect(mutationIds[1]).toBe(mutationIds[0]);

  // Deliberate subsequent create gets a new mutation ID
  await input.fill("Evening walk");
  await addButton.click();

  await expect(card.getByRole("button", { name: /Evening walk/ })).toBeVisible();
  expect(mutationIds.length).toBe(3);
  expect(mutationIds[2]).toBeTruthy();
  expect(mutationIds[2]).not.toBe(mutationIds[0]);

  // Verify DB has exactly 2 habits, not 3 (the retry was idempotent)
  await page.reload();
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /Evening walk/ })).toBeVisible();
});

test("separates confirmed write success from read-refresh failure", async ({ page }) => {
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
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
  // The draft was cleared on confirmed write
  await expect(input).toHaveValue("");
  // It does NOT claim habit could not be saved
  await expect(page.getByText("Habit could not be saved. Your draft is still here.")).toHaveCount(0);

  // When refresh recovers, the habit is still there
  failRefresh = false;
  await page.reload();
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toBeVisible();
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

