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
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
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

/**
 * The toggle's accessible name is "<Project>, <Status>" — the status dot is
 * decorative, so the status is announced through the button instead.
 */
function projectToggle(page: Page, name: string) {
  return page.locator(".project-row-toggle").filter({ hasText: name });
}

function projectRowFor(page: Page, name: string) {
  return page.locator(".project-row").filter({ has: projectToggle(page, name) });
}

async function openListProjects(page: Page) {
  await openDashboard(page);
  await page.getByRole("button", { name: /^Projects/ }).click();
  await page.getByRole("radio", { name: "List", exact: true }).click();
}

test("keeps the Projects controls inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Rendered phone Project");
  await openListProjects(page);

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

test("keeps List Project open controls touch-sized on phone", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Touch-sized Project");
  await openListProjects(page);

  const openTarget = await projectToggle(page, "Touch-sized Project").boundingBox();
  expect(openTarget).not.toBeNull();
  expect(openTarget!.height).toBeGreaterThanOrEqual(44);
});

test("defaults to Cards and persists List without a Cards flash", async ({
  page
}) => {
  await createProject(page, "Persistent view Project");
  await openDashboard(page);
  await page.getByRole("button", { name: /^Projects/ }).click();

  const projectView = page.getByRole("radiogroup", { name: "Project view" });
  await expect(
    projectView.getByRole("radio", { name: "Cards", exact: true })
  ).toBeChecked();

  await projectView.getByRole("radio", { name: "List", exact: true }).click();
  await expect(page.locator(".project-row")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.dataset.projectsViewHistory = "";
    const recordProjectsView = () => {
      const root = document.documentElement;
      const history = root.dataset.projectsViewHistory ?? "";
      if (document.querySelector(".project-card")) {
        root.dataset.projectsViewHistory = `${history}cards,`;
      } else if (document.querySelector(".project-row")) {
        root.dataset.projectsViewHistory = `${history}list,`;
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
      .getByRole("radio", { name: "List", exact: true })
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
  const listOption = projectView.getByRole("radio", {
    name: "List",
    exact: true
  });

  await cards.focus();
  await page.keyboard.press("ArrowRight");
  await expect(listOption).toBeChecked();
  await expect(listOption).toBeFocused();
  await expect(cards).toHaveAttribute("tabindex", "-1");
  await expect(listOption).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("ArrowLeft");
  await expect(cards).toBeChecked();
  await expect(cards).toBeFocused();
});

test("contains large task counts inside their List column", async ({ page }) => {
  seedProjectWithManyTasks();
  await openListProjects(page);

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

test("aligns List columns for Projects with and without tasks", async ({
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
  await openListProjects(page);

  const withTaskRow = projectRowFor(page, "Project with a next task");
  const withoutTasksRow = projectRowFor(page, "Project without tasks");

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
      `${selector} should begin in the same column for every List row`
    ).toBeLessThanOrEqual(1);
  }
});

test("expands a List row to its tasks and leaves the row's own controls alone", async ({
  page
}) => {
  const project = await createProject(page, "Expandable Project");
  for (const [title, status] of [
    ["Still to do", "TODO"],
    ["Already finished", "DONE"]
  ] as const) {
    const created = await page.request.post("/api/tasks", {
      data: {
        title,
        status,
        projectId: project.id,
        date: null,
        estimateMinutes: 45
      }
    });
    expect(created.status()).toBe(201);
  }

  await openListProjects(page);

  const row = projectRowFor(page, "Expandable Project");
  const disclosure = projectToggle(page, "Expandable Project");

  // Collapsed: the drawer does not exist, so its tasks are not merely hidden.
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(row.locator(".project-row-drawer")).toHaveCount(0);

  await disclosure.click();

  const drawer = row.locator(".project-row-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Still to do")).toBeVisible();
  await expect(drawer.getByText("Already finished")).toBeVisible();
  await expect(drawer.locator("li.is-done")).toHaveCount(1);
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  // Expanding is not navigation: the overview is still on screen.
  await expect(
    page.getByRole("radiogroup", { name: "Project view" })
  ).toBeVisible();

  // Opening the Project is its own explicit control at the end of the row.
  await row
    .getByRole("button", { name: "Open Expandable Project overview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Expandable Project" })
  ).toBeVisible();
});

test("keeps each List row's drawer independent", async ({ page }) => {
  const first = await createProject(page, "First Project");
  await createProject(page, "Second Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Only in the first",
      projectId: first.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);

  await openListProjects(page);

  const firstRow = projectRowFor(page, "First Project");
  const secondRow = projectRowFor(page, "Second Project");
  // Scoped to the drawer: this title also appears as the row's "Next:" summary.
  const firstDrawerTask = firstRow
    .locator(".project-row-drawer")
    .getByText("Only in the first");

  await projectToggle(page, "First Project").click();
  await expect(firstDrawerTask).toBeVisible();
  await expect(secondRow.locator(".project-row-drawer")).toHaveCount(0);

  await projectToggle(page, "Second Project").click();
  await expect(secondRow.getByText("No tasks yet.")).toBeVisible();
  await expect(firstDrawerTask).toBeVisible();
});

test("labels only the scheduled tasks in a List drawer", async ({ page }) => {
  // Nearly every Project task is unscheduled, so labelling that state marked
  // every row and separated none of them. Only the exception is labelled.
  const project = await createProject(page, "Mixed Project");
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  for (const [title, status, date] of [
    ["Unscheduled work", "TODO", null],
    ["Planned for a day", "TODO", todayKey],
    ["Finished already", "DONE", null]
  ] as const) {
    const created = await page.request.post("/api/tasks", {
      data: { title, status, projectId: project.id, date, estimateMinutes: 45 }
    });
    expect(created.status()).toBe(201);
  }

  await openListProjects(page);
  await projectToggle(page, "Mixed Project").click();

  const drawer = page.locator(".project-row-drawer");
  const metaFor = (title: string) =>
    drawer.locator("li").filter({ hasText: title }).locator(".project-row-task-meta");

  await expect(metaFor("Planned for a day")).not.toBeEmpty();
  await expect(metaFor("Unscheduled work")).toBeEmpty();
  await expect(metaFor("Finished already")).toBeEmpty();

  // Completion is carried by the mark and the muted title, so it is announced
  // rather than spelled out a third time in the column.
  await expect(
    drawer.locator("li.is-done").getByText("Done:")
  ).toBeAttached();
});

test("retries a failed task load in place instead of collapsing", async ({
  page
}) => {
  const project = await createProject(page, "Flaky Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Arrives on the retry",
      projectId: project.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);

  // Fail only the first detail request, then let the retry through.
  let failed = false;
  await page.route(`**/api/projects/${project.id}`, (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.fulfill({ status: 500, body: "{}" });
  });

  await openListProjects(page);
  const toggle = projectToggle(page, "Flaky Project");
  await toggle.click();

  const drawer = projectRowFor(page, "Flaky Project").locator(
    ".project-row-drawer"
  );
  await expect(drawer.getByText("These tasks could not be loaded.")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await drawer.getByRole("button", { name: "Try again" }).click();

  // The drawer must still be open, now showing the tasks.
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.getByText("Arrives on the retry")).toBeVisible();
});

test("keeps the configured Phase order in a List drawer", async ({ page }) => {
  // Groups are seeded from the Project's phase order, not from the order
  // tasks happen to sort in. A phase holding only completed work would
  // otherwise fall behind a later one, because completed tasks sort last.
  const project = await createProject(page, "Phased Project");
  const phaseIds: string[] = [];
  for (const name of ["First phase", "Second phase"]) {
    const created = await page.request.post(
      `/api/projects/${project.id}/phases`,
      { data: { name } }
    );
    expect(created.ok()).toBe(true);
    phaseIds.push(((await created.json()) as { id: string }).id);
  }

  for (const [title, status, phaseId] of [
    ["Finished first-phase work", "DONE", phaseIds[0]],
    ["Open second-phase work", "TODO", phaseIds[1]]
  ] as const) {
    const created = await page.request.post("/api/tasks", {
      data: {
        title,
        status,
        projectId: project.id,
        phaseId,
        date: null,
        estimateMinutes: 30
      }
    });
    expect(created.status()).toBe(201);
  }

  await openListProjects(page);
  await projectToggle(page, "Phased Project").click();

  const drawer = projectRowFor(page, "Phased Project").locator(
    ".project-row-drawer"
  );
  await expect(drawer.locator(".project-row-phase")).toHaveText([
    "First phase",
    "Second phase"
  ]);
});
