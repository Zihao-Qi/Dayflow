import { expect, test, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedProjectWithManyTasks
} from "./database";

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
  await page.getByRole("radio", { name: "Compact", exact: true }).click();
}

test("keeps the Projects controls inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Rendered phone Project");
  await openCompactProjects(page);

  const widths = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    listClientWidth: document.querySelector<HTMLElement>(".project-list")
      ?.clientWidth,
    listScrollWidth: document.querySelector<HTMLElement>(".project-list")
      ?.scrollWidth
  }));

  expect(widths.documentScrollWidth).toBe(widths.documentClientWidth);
  expect(widths.listClientWidth).toBeGreaterThan(0);
  expect(widths.listScrollWidth).toBe(widths.listClientWidth);
  await expect(page.locator(".project-row-tasks")).toBeHidden();
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

test("defaults to Cards and persists Compact without a Cards flash", async ({
  page
}) => {
  await createProject(page, "Persistent view Project");
  await openDashboard(page);
  await page.getByRole("button", { name: /^Projects/ }).click();

  const projectView = page.getByRole("radiogroup", { name: "Project view" });
  await expect(
    projectView.getByRole("radio", { name: "Cards", exact: true })
  ).toBeChecked();

  await projectView.getByRole("radio", { name: "Compact", exact: true }).click();
  await expect(page.locator(".project-row")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: /blocks? left$/ })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.dataset.projectsViewHistory = "";
    const recordProjectsView = () => {
      const root = document.documentElement;
      const history = root.dataset.projectsViewHistory ?? "";
      if (document.querySelector(".project-card")) {
        root.dataset.projectsViewHistory = `${history}cards,`;
      } else if (document.querySelector(".project-row")) {
        root.dataset.projectsViewHistory = `${history}compact,`;
      }
    };
    new MutationObserver(recordProjectsView).observe(document.body, {
      childList: true,
      subtree: true
    });
  });

  await page.getByRole("button", { name: /^Projects/ }).click();
  await expect(
    page
      .getByRole("radiogroup", { name: "Project view" })
      .getByRole("radio", { name: "Compact", exact: true })
  ).toBeChecked();
  await expect(page.locator(".project-row")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.dataset.projectsViewHistory
    )
  ).not.toContain("cards");
});

test("supports roving keyboard selection for the Project view", async ({ page }) => {
  await createProject(page, "Keyboard view Project");
  await openDashboard(page);
  await page.getByRole("button", { name: /^Projects/ }).click();

  const projectView = page.getByRole("radiogroup", { name: "Project view" });
  const cards = projectView.getByRole("radio", { name: "Cards", exact: true });
  const compact = projectView.getByRole("radio", {
    name: "Compact",
    exact: true
  });

  await cards.focus();
  await page.keyboard.press("ArrowRight");
  await expect(compact).toBeChecked();
  await expect(compact).toBeFocused();
  await expect(cards).toHaveAttribute("tabindex", "-1");
  await expect(compact).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("ArrowLeft");
  await expect(cards).toBeChecked();
  await expect(cards).toBeFocused();
});

test("contains large task counts inside their Compact column", async ({ page }) => {
  seedProjectWithManyTasks();
  await openCompactProjects(page);

  const taskCount = page.locator(".project-row-tasks");
  await expect(taskCount).toHaveText("120/300 tasks");
  const overflow = await taskCount.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow
    };
  });
  expect(overflow.overflow).not.toBe("visible");
  expect(overflow.textOverflow).toBe("ellipsis");
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
