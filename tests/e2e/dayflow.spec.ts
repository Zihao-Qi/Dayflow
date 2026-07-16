import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make today legible" })).toBeVisible();
}

async function addTask(page: Page, title: string) {
  await page.getByPlaceholder("Add a task for today").fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(taskRow(page, title)).toBeVisible();
}

function taskRow(page: Page, title: string) {
  return page.getByRole("article", { name: `Task: ${title}`, exact: true });
}

test("records, persists, totals, and deletes an activity", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Ship browser coverage");

  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(page.getByText("Add a short note about what happened.")).toBeVisible();

  await page.getByPlaceholder("Record a small win or what moved forward.").fill(
    "Covered the activity log flow"
  );
  await page.getByLabel("Minutes", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(page.getByText("Duration must be between 1 and 1440 minutes.")).toBeVisible();

  await page.getByLabel("Minutes", { exact: true }).fill("15");
  await page.getByRole("combobox", { name: "Category" }).selectOption("Deep Work");
  await page.getByRole("combobox", { name: "Linked task" }).selectOption({
    label: "Ship browser coverage"
  });
  const createActivity = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/activities") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Add activity" }).click();
  expect((await createActivity).ok()).toBe(true);

  await expect(page.getByText("Covered the activity log flow", { exact: true })).toBeVisible();
  await expect(page.getByText("Linked to Ship browser coverage", { exact: true })).toBeVisible();
  await expect(page.getByText("15m recorded", { exact: true })).toBeVisible();
  await expect(page.locator(".metric").filter({ hasText: "Spent" })).toContainText("15m");

  await page.reload();
  await expect(page.getByText("Covered the activity log flow", { exact: true })).toBeVisible();
  await expect(page.getByText("15m recorded", { exact: true })).toBeVisible();

  const deleteActivity = page.waitForResponse(
    (response) =>
      response.url().includes("/api/activities/") && response.request().method() === "DELETE"
  );
  await page
    .getByRole("button", {
      name: "Delete activity: Covered the activity log flow"
    })
    .click();
  expect((await deleteActivity).ok()).toBe(true);
  await expect(page.getByText("Covered the activity log flow", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0m recorded", { exact: true })).toBeVisible();
});

test("persists task completion and switches between the main sections", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Verify completion");

  const completeTask = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tasks/") && response.request().method() === "PATCH"
  );
  await taskRow(page, "Verify completion").getByRole("button", { name: "Complete task" }).click();
  expect((await completeTask).ok()).toBe(true);
  await expect(page.getByText("100% complete", { exact: true })).toBeVisible();

  await page.reload();
  await expect(
    taskRow(page, "Verify completion").getByRole("button", { name: "Mark incomplete" })
  ).toBeVisible();

  const sections = [
    ["Plan", "Plan the next blocks"],
    ["Notes", "Capture what matters"],
    ["Materials", "Keep useful references close"],
    ["Review", "Close the day with intention"],
    ["Today", "Make today legible"]
  ] as const;

  for (const [tab, heading] of sections) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  await page.getByTitle("Toggle compact mode").click();
  await expect(page.locator(".workspace")).toHaveClass(/compact-mode/);
});

test("persists task drag reordering", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "First task");
  await addTask(page, "Second task");

  const firstRow = taskRow(page, "First task");
  const secondRow = taskRow(page, "Second task");

  await firstRow.locator(".drag-handle").hover();
  await expect(firstRow).toHaveAttribute("draggable", "true");
  const sourceBox = await firstRow.locator(".drag-handle").boundingBox();
  const targetBox = await secondRow.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("The task rows are not visible for reordering.");

  const reorderTasks = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/reorder") && response.request().method() === "POST",
    { timeout: 10_000 }
  );
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12
  });
  await page.mouse.up();
  expect((await reorderTasks).ok()).toBe(true);

  await expect
    .poll(() =>
      page.locator(".task-list .task-title-input").evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value)
      )
    )
    .toEqual(["Second task", "First task"]);

  await page.reload();
  await expect
    .poll(() =>
      page.locator(".task-list .task-title-input").evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value)
      )
    )
    .toEqual(["Second task", "First task"]);
});

test("updates urgency and importance through matrix placement", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Place on matrix");

  const board = page.locator(".matrix-board");
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error("The urgency and importance matrix is not visible.");

  await page
    .locator(".matrix-task")
    .filter({ hasText: "Place on matrix" })
    .dragTo(board, {
      targetPosition: {
        x: Math.round(boardBox.width - 10),
        y: 10
      }
    });

  const row = taskRow(page, "Place on matrix");
  await expect(row.getByRole("radio", { name: "Urgency 5 of 5" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(row.getByRole("radio", { name: "Importance 5 of 5" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
});

test("keeps mobile navigation visible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openDashboard(page);

  const navItems = page.locator(".nav-list .nav-item");
  await expect(navItems).toHaveCount(5);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The mobile viewport was not applied.");

  for (let index = 0; index < (await navItems.count()); index += 1) {
    const item = navItems.nth(index);
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    if (!box) throw new Error(`Mobile navigation item ${index + 1} has no bounding box.`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Close the day with intention" })
  ).toBeVisible();
});
