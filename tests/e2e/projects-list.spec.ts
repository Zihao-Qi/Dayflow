import { expect, test, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedProjectWithManyTasks,
  setFocusSessionElapsedMinutes
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
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Still to do" })
  ).toBeVisible();
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Already finished" })
  ).toBeVisible();
  await expect(drawer.locator(".project-task.done")).toHaveCount(1);
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
    .getByRole("textbox", { name: "Task title: Only in the first" });

  await projectToggle(page, "First Project").click();
  await expect(firstDrawerTask).toBeVisible();
  await expect(secondRow.locator(".project-row-drawer")).toHaveCount(0);

  await projectToggle(page, "Second Project").click();
  await expect(secondRow.getByText("No tasks yet.")).toBeVisible();
  await expect(firstDrawerTask).toBeVisible();
});

test("keeps a completed Project's drawer tasks visible without mutating controls", async ({
  page
}) => {
  const project = await createProject(page, "Completed drawer Project");
  const phase = await page.request.post(`/api/projects/${project.id}/phases`, {
    data: { name: "Preserved phase" }
  });
  expect(phase.status()).toBe(201);
  const phaseId = ((await phase.json()) as { id: string }).id;

  // Completion can be confirmed with unfinished work still in the plan.
  // Exercise the Done, Backlog and scheduled rows, including Schedule/Focus.
  for (const [title, status, date] of [
    ["Finished evidence", "DONE", null],
    ["Unfinished backlog", "TODO", null],
    ["Unfinished scheduled", "TODO", "2026-09-05"]
  ] as const) {
    const task = await page.request.post("/api/tasks", {
      data: { title, status, date, projectId: project.id, phaseId, estimateMinutes: 30 }
    });
    expect(task.status()).toBe(201);
  }
  const completed = await page.request.patch(`/api/projects/${project.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(completed.ok()).toBe(true);

  await openListProjects(page);
  await page.getByRole("button", { name: /^Completed/ }).click();
  await projectToggle(page, "Completed drawer Project").click();

  const drawer = projectRowFor(page, "Completed drawer Project").locator(
    ".project-row-drawer"
  );
  await expect(drawer.locator(".project-task")).toHaveCount(3);
  // This assertion fails on the original code: Reopen is enabled and sends
  // status: TODO, which the API rejects for a completed Project.
  await expect(
    drawer.getByRole("button", { name: "Reopen Finished evidence", exact: true })
  ).toBeDisabled();

  for (const title of ["Finished evidence", "Unfinished backlog", "Unfinished scheduled"]) {
    const input = drawer.getByRole("textbox", { name: `Task title: ${title}`, exact: true });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(title);
    await expect(input).toBeDisabled();
    const phaseSelect = drawer.getByRole("combobox", { name: `Phase for ${title}`, exact: true });
    await expect(phaseSelect).toBeDisabled();
    await expect(phaseSelect).toHaveValue(phaseId);
  }
  for (const title of ["Unfinished backlog", "Unfinished scheduled"]) {
    await expect(
      drawer.getByRole("button", { name: `Complete ${title}`, exact: true })
    ).toBeDisabled();
  }
  await expect(drawer.locator(".project-task-state.done")).toHaveText("Done");
  await expect(drawer.locator(".project-task-state.backlog")).toHaveText("Backlog");
  await expect(drawer.getByText("Preserved phase", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByLabel("Schedule Unfinished backlog", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Focus 30m", exact: true })).toBeDisabled();
  await expect(drawer.locator(".project-task:not(.done):not(.backlog) .project-task-meta")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Delete task/ })).toHaveCount(0);
  await expect(drawer.locator(".project-row-add-task")).toHaveCount(0);
  await expect(drawer.locator("button:enabled, input:enabled, select:enabled")).toHaveCount(0);
  await expect(
    drawer.getByText("Reopen this Project before editing tasks or adding unfinished work.", { exact: true })
  ).toBeVisible();
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
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Arrives on the retry" })
  ).toBeVisible();
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

test("puts unphased tasks above the Phase groups, as the Project page does", async ({
  page
}) => {
  const project = await createProject(page, "Mixed grouping Project");
  const phase = await page.request.post(`/api/projects/${project.id}/phases`, {
    data: { name: "A phase" }
  });
  expect(phase.ok()).toBe(true);
  const phaseId = ((await phase.json()) as { id: string }).id;

  for (const [title, taskPhase] of [
    ["Inside the phase", phaseId],
    ["Loose in the project", null]
  ] as const) {
    const created = await page.request.post("/api/tasks", {
      data: {
        title,
        projectId: project.id,
        phaseId: taskPhase,
        date: null,
        estimateMinutes: 30
      }
    });
    expect(created.status()).toBe(201);
  }

  await openListProjects(page);
  await projectToggle(page, "Mixed grouping Project").click();

  const drawer = projectRowFor(page, "Mixed grouping Project").locator(
    ".project-row-drawer"
  );
  await expect(drawer.locator(".project-row-phase")).toHaveText([
    "No phase",
    "A phase"
  ]);
});

test("refreshes a cached drawer when Focus marks its Task done", async ({
  page
}) => {
  // The Focus rail is app-wide, so a session started from this row can be
  // completed without ever leaving Projects. Marking the Task done there
  // updates the row summary; the drawer's cached fetch has to drop with it,
  // or the same screen shows an unfinished Task beside 1/1 complete.
  const project = await createProject(page, "Refreshing Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Finish me",
      projectId: project.id,
      date: null,
      estimateMinutes: 5
    }
  });
  expect(created.status()).toBe(201);

  await openListProjects(page);
  const row = projectRowFor(page, "Refreshing Project");
  await projectToggle(page, "Refreshing Project").click();

  const drawer = row.locator(".project-row-drawer");
  await expect(drawer.locator(".project-task")).toHaveCount(1);
  await expect(drawer.locator(".project-task.done")).toHaveCount(0);

  // The row's Focus button only prefills the rail; the session starts there.
  await row.getByRole("button", { name: /^Focus \d+m on Finish me$/ }).click();
  const rail = page.getByRole("complementary", { name: "Focus rail" });
  const startFocus = page.waitForResponse(
    (response) =>
      response.url().includes("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await rail.getByRole("button", { name: /^Start \d+m focus$/ }).click();
  const { session } = (await (await startFocus).json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 3);

  await rail.getByRole("button", { name: /^Finish( \d+m)?$/ }).click();
  await rail.getByRole("button", { name: "Mark done" }).click();
  await rail.getByRole("button", { name: /Save|Finish without details/ }).first().click();

  // The summary moves, and the drawer must move with it.
  await expect(row.locator(".project-row-tasks")).toContainText("1/1");
  await expect(drawer.locator(".project-task.done")).toHaveCount(1);
});

test("reloads after a stale in-flight task request settles", async ({ page }) => {
  // The summary can move while the detail GET is still in flight. That
  // response carries pre-change data, so it must not install itself and leave
  // the drawer stale with nothing left to correct it.
  //
  // The first response is held on an explicit gate rather than a timer, so
  // it is guaranteed to settle *after* the Task has been completed.
  const project = await createProject(page, "Slow Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Finish me slowly",
      projectId: project.id,
      date: null,
      estimateMinutes: 5
    }
  });
  expect(created.status()).toBe(201);

  // Captured before anything changes. Replaying this body later is what makes
  // the held response genuinely stale — forwarding the request instead would
  // simply fetch fresh data at release time and prove nothing.
  const preChange = await page.request.get(`/api/projects/${project.id}`);
  expect(preChange.ok()).toBe(true);
  const preChangeBody = await preChange.text();

  let releaseStaleResponse: () => void = () => {};
  const staleResponseGate = new Promise<void>((resolve) => {
    releaseStaleResponse = resolve;
  });
  let served = 0;
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    served += 1;
    if (served > 1) return route.continue();
    await staleResponseGate;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: preChangeBody
    });
  });

  await openListProjects(page);
  const row = projectRowFor(page, "Slow Project");
  await projectToggle(page, "Slow Project").click();

  // Complete the Task while that first request is still held open.
  await row
    .getByRole("button", { name: /^Focus \d+m on Finish me slowly$/ })
    .click();
  const rail = page.getByRole("complementary", { name: "Focus rail" });
  const startFocus = page.waitForResponse(
    (response) =>
      response.url().includes("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await rail.getByRole("button", { name: /^Start \d+m focus$/ }).click();
  const { session } = (await (await startFocus).json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 3);
  await rail.getByRole("button", { name: /^Finish( \d+m)?$/ }).click();
  await rail.getByRole("button", { name: "Mark done" }).click();
  await rail
    .getByRole("button", { name: /Save|Finish without details/ })
    .first()
    .click();

  await expect(row.locator(".project-row-tasks")).toContainText("1/1");

  // Only now let the pre-change response land.
  releaseStaleResponse();

  await expect(
    row.locator(".project-row-drawer .project-task.done")
  ).toHaveCount(1, { timeout: 15_000 });
});

test("renames a task from the List drawer without leaving Projects", async ({
  page
}) => {
  const project = await createProject(page, "Editable Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Original title",
      projectId: project.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);

  await openListProjects(page);
  await projectToggle(page, "Editable Project").click();

  const drawer = projectRowFor(page, "Editable Project").locator(
    ".project-row-drawer"
  );
  const title = drawer.getByRole("textbox", { name: "Task title: Original title" });
  await expect(title).toBeVisible();
  await title.fill("Renamed in the drawer");
  await title.blur();

  // Still on the overview, and the change reached the server.
  await expect(
    page.getByRole("radiogroup", { name: "Project view" })
  ).toBeVisible();
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Renamed in the drawer" })
  ).toBeVisible();

  const detail = await page.request.get(`/api/projects/${project.id}`);
  const body = (await detail.json()) as { tasks: Array<{ title: string }> };
  expect(body.tasks.map((task) => task.title)).toEqual([
    "Renamed in the drawer"
  ]);
});

test("adds a task from the List drawer and updates the row summary", async ({
  page
}) => {
  const project = await createProject(page, "Growing Project");

  await openListProjects(page);
  const row = projectRowFor(page, "Growing Project");
  await projectToggle(page, "Growing Project").click();

  const drawer = row.locator(".project-row-drawer");
  await expect(drawer.getByText("No tasks yet.")).toBeVisible();

  await drawer.getByRole("textbox", { name: "New Project task" }).fill("Brand new task");
  await drawer.getByRole("button", { name: /^Add$/ }).click();

  // The drawer reloads and the summary beside it moves with it.
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Brand new task" })
  ).toBeVisible();
  await expect(row.locator(".project-row-tasks")).toContainText("0/1");
});

test("keeps an add draft mounted while another drawer task refreshes", async ({
  page
}) => {
  const project = await createProject(page, "Draft-safe Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Existing task",
      projectId: project.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);

  await openListProjects(page);
  const row = projectRowFor(page, "Draft-safe Project");
  await projectToggle(page, "Draft-safe Project").click();

  const drawer = row.locator(".project-row-drawer");
  const draft = drawer.getByRole("textbox", { name: "New Project task" });
  await draft.fill("Do not lose this");

  let releaseReload = () => {};
  const reloadHeld = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  let reportReloadStarted = () => {};
  const reloadStarted = new Promise<void>((resolve) => {
    reportReloadStarted = resolve;
  });
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    reportReloadStarted();
    await reloadHeld;
    await route.continue();
  });

  await drawer.getByRole("button", { name: "Complete Existing task" }).click();
  await reloadStarted;
  try {
    await expect(drawer.getByRole("status")).toContainText("Refreshing tasks");
    await expect(draft).toHaveValue("Do not lose this");
  } finally {
    releaseReload();
  }

  await expect(drawer.locator(".project-task.done")).toHaveCount(1);
  await expect(row.locator(".project-row-tasks")).toContainText("1/1");
  await expect(drawer.getByRole("status")).toHaveCount(0);
  await expect(draft).toHaveValue("Do not lose this");
});

test("deletes a task from the List drawer", async ({ page }) => {
  const project = await createProject(page, "Shrinking Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Doomed task",
      projectId: project.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);

  await openListProjects(page);
  const row = projectRowFor(page, "Shrinking Project");
  await projectToggle(page, "Shrinking Project").click();

  const drawer = row.locator(".project-row-drawer");
  await drawer.getByRole("button", { name: "Delete task Doomed task" }).click();
  await drawer
    .getByRole("button", { name: "Delete task", exact: true })
    .click();

  await expect(drawer.getByText("No tasks yet.")).toBeVisible();
  await expect(row.locator(".project-row-tasks")).toContainText("No tasks yet");
});

test("reconciles a drawer delete whose response is lost", async ({ page }) => {
  const project = await createProject(page, "Reconciled Project");
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Deleted despite the disconnect",
      projectId: project.id,
      date: null,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };

  let dropped = false;
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() !== "DELETE" || dropped) {
      return route.continue();
    }
    dropped = true;
    const forwarded = await page.request.delete(`/api/tasks/${task.id}`, {
      headers: route.request().headers()
    });
    expect(forwarded.status()).toBe(200);
    return route.abort("connectionfailed");
  });

  await openListProjects(page);
  const row = projectRowFor(page, "Reconciled Project");
  await projectToggle(page, "Reconciled Project").click();

  const drawer = row.locator(".project-row-drawer");
  await drawer
    .getByRole("button", { name: "Delete task Deleted despite the disconnect" })
    .click();
  await drawer
    .getByRole("button", { name: "Delete task", exact: true })
    .click();

  // The failed response is ambiguous, so the drawer and overview reconcile
  // with the server before asking the user to retry.
  await expect(drawer.getByText("No tasks yet.")).toBeVisible();
  await expect(row.locator(".project-row-tasks")).toContainText("No tasks yet");

  const detail = await page.request.get(`/api/projects/${project.id}`);
  const body = (await detail.json()) as { tasks: Array<{ id: string }> };
  expect(body.tasks).toHaveLength(0);
});

test("replays a lost drawer create instead of adding the task twice", async ({
  page
}) => {
  // The server commits, then the response is lost. The drawer keeps the title
  // and the user retries — which must be recognised as a replay, not a second
  // create.
  const project = await createProject(page, "Idempotent Project");

  let dropped = false;
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST" || dropped) return route.continue();
    dropped = true;
    // Forward it verbatim — headers included, so the mutation id is present
    // or absent exactly as the app sent it — then throw the response away.
    const forwarded = await page.request.post("/api/tasks", {
      data: route.request().postDataJSON(),
      headers: route.request().headers()
    });
    expect(forwarded.status()).toBe(201);
    return route.abort("connectionfailed");
  });

  await openListProjects(page);
  const row = projectRowFor(page, "Idempotent Project");
  await projectToggle(page, "Idempotent Project").click();

  const drawer = row.locator(".project-row-drawer");
  const input = drawer.getByRole("textbox", { name: "New Project task" });
  await input.fill("Only once please");
  await drawer.getByRole("button", { name: /^Add$/ }).click();

  // The failure is reported and the draft survives for the retry.
  await expect(drawer.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("Only once please");

  await drawer.getByRole("button", { name: /^Add$/ }).click();
  await expect(
    drawer.getByRole("textbox", { name: "Task title: Only once please" })
  ).toBeVisible();

  const detail = await page.request.get(`/api/projects/${project.id}`);
  const body = (await detail.json()) as { tasks: Array<{ title: string }> };
  expect(body.tasks.filter((t) => t.title === "Only once please")).toHaveLength(
    1
  );
});
