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
