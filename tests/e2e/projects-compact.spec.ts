import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /blocks? left$/ })).toBeVisible({
    timeout: 30_000
  });
}

async function createProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { name }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

async function openCompactProjects(page: Page) {
  await openDashboard(page);
  await page.getByRole("button", { name: /^Projects/ }).click();
  await page.getByRole("button", { name: "Compact", exact: true }).click();
}

test("keeps the Projects controls inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCompactProjects(page);

  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(pageWidth.scrollWidth).toBe(pageWidth.clientWidth);
});

test("keeps Compact Project open controls touch-sized on phone", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Touch-sized Project");
  await openCompactProjects(page);

  const openTarget = await page
    .getByRole("button", { name: "Touch-sized Project", exact: true })
    .boundingBox();
  expect(openTarget).not.toBeNull();
  expect(openTarget!.height).toBeGreaterThanOrEqual(44);
});

test("aligns Compact columns for Projects with and without tasks", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const withTask = await createProject(page, "Project with a next task");
  await createProject(page, "Project without tasks");
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "The next action",
      projectId: withTask.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(taskResponse.status()).toBe(201);
  await openCompactProjects(page);

  const withTaskRow = page.locator(".project-row").filter({
    has: page.getByRole("button", {
      name: "Project with a next task",
      exact: true
    })
  });
  const withoutTasksRow = page.locator(".project-row").filter({
    has: page.getByRole("button", {
      name: "Project without tasks",
      exact: true
    })
  });

  for (const selector of [
    ".project-row-progress",
    ".project-row-tasks",
    ".project-row-next"
  ]) {
    const withTaskBox = await withTaskRow.locator(selector).boundingBox();
    const withoutTasksBox = await withoutTasksRow.locator(selector).boundingBox();
    expect(withTaskBox).not.toBeNull();
    expect(withoutTasksBox).not.toBeNull();
    expect(
      Math.abs(withTaskBox!.x - withoutTasksBox!.x),
      `${selector} should begin in the same column for every Compact row`
    ).toBeLessThanOrEqual(1);
  }
});
