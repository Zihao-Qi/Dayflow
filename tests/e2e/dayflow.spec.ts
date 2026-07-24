import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, setFocusSessionElapsedMinutes } from "./database";

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

  await page.getByText("Record activity", { exact: true }).click();
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

test("persists a focus timer and records completed work", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Write the focus timer test");

  const row = taskRow(page, "Write the focus timer test");
  await row
    .getByRole("button", { name: "Show task details: Write the focus timer test" })
    .click();
  await row.getByRole("button", { name: "Start focus", exact: true }).click();
  await expect(page.getByLabel("Focus task").locator("option:checked")).toHaveText(
    "Write the focus timer test"
  );

  await page.getByRole("button", { name: "Custom 1–240m" }).click();
  await page.getByLabel("Custom focus minutes").fill("5");
  await page.getByPlaceholder("What will you move forward?").fill("Verify persistent focus");

  const startFocus = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Start 5m focus" }).click();
  const startResponse = await startFocus;
  expect(startResponse.ok()).toBe(true);
  const { session } = (await startResponse.json()) as { session: { id: string } };

  await expect(page.getByRole("heading", { name: "Verify persistent focus" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Focus timer" })
      .getByText("Write the focus timer test", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const activeBanner = page.getByRole("region", { name: "Active focus session" });
  await expect(activeBanner.getByText("Verify persistent focus", { exact: true })).toBeVisible();

  const pauseFocus = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/focus-session/${session.id}`) &&
      response.request().method() === "PATCH"
  );
  await activeBanner.getByRole("button", { name: "Pause timer", exact: true }).click();
  expect((await pauseFocus).ok()).toBe(true);
  await expect(
    activeBanner.getByRole("button", { name: "Resume timer", exact: true })
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verify persistent focus" })).toBeVisible();

  setFocusSessionElapsedMinutes(session.id, 2);
  const resumeFocus = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/focus-session/${session.id}`) &&
      response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  expect((await resumeFocus).ok()).toBe(true);

  const finishFocus = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/focus-session/${session.id}`) &&
      response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Finish early", exact: true }).click();
  expect((await finishFocus).ok()).toBe(true);

  await expect(page.getByText("Focus session · Verify persistent focus")).toBeVisible();
  await expect(page.getByText("1 session · 2m", { exact: true })).toBeVisible();
  await expect(page.locator(".metric").filter({ hasText: "Spent" })).toContainText("2m");
  await expect(page.getByText("Focus block saved. Take a 2-minute break?")).toBeVisible();

  const startBreak = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Start break", exact: true }).click();
  expect((await startBreak).ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Break", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("saves a Today task title once after editing finishes", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Draft title");

  let titlePatchCount = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().includes("/api/tasks/") &&
      request.postData()?.includes('"title"')
    ) {
      titlePatchCount += 1;
    }
  });

  const titleInput = taskRow(page, "Draft title").getByLabel("Task title: Draft title");
  await titleInput.fill("A stable edited title");
  expect(titlePatchCount).toBe(0);

  const saveTitle = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tasks/") &&
      response.request().method() === "PATCH"
  );
  await titleInput.press("Enter");
  expect((await saveTitle).ok()).toBe(true);
  expect(titlePatchCount).toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(taskRow(page, "A stable edited title")).toBeVisible();
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
  await page.getByText("Completed · 1", { exact: true }).click();
  await expect(
    taskRow(page, "Verify completion").getByRole("button", { name: "Mark incomplete" })
  ).toBeVisible();

  const sections = [
    ["Plan", "Plan with intention"],
    ["Journal", "Keep what matters"],
    ["Review", "Close the day with intention"],
    ["Today", "Make today legible"]
  ] as const;

  for (const [tab, heading] of sections) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  await page.getByRole("button", { name: "Open tools" }).click();
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

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Day plan", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("tab", { name: "List", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Matrix", exact: true }).click();
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

  await page.getByRole("button", { name: "Today", exact: true }).click();
  const row = taskRow(page, "Place on matrix");
  await row.getByRole("button", { name: "Show task details: Place on matrix" }).click();
  await expect(row.getByRole("radio", { name: "Urgency 5 of 5" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(row.getByRole("radio", { name: "Importance 5 of 5" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
});

test("creates a project with optional phases and tracks backlog progress", async ({ page }) => {
  await openDashboard(page);

  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name Required").fill("Complete the systems course");
  await page.getByText("Optional details", { exact: true }).click();
  await page.getByLabel("Target duration value").fill("8");
  await page.getByLabel("Target duration unit").selectOption("WEEKS");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(
    page.getByRole("heading", { name: "Complete the systems course", exact: true })
  ).toBeVisible();
  await expect(page.getByText("8 weeks expected", { exact: true })).toBeVisible();
  await expect(page.getByText("No tasks", { exact: true }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page.getByPlaceholder("Add an optional phase").fill("Foundations");
  await page.getByRole("button", { name: "Add phase" }).click();
  await expect(page.getByLabel("Phase name: Foundations")).toBeVisible();

  const addTaskPanel = page.locator(".project-add-task");
  await addTaskPanel.getByLabel("New Project task").fill("Finish module one exercises");
  await addTaskPanel.getByLabel("Task phase").selectOption({ label: "Foundations" });
  await addTaskPanel.getByRole("button", { name: "Add", exact: true }).click();

  const backlog = page.locator(".project-backlog");
  await expect(
    backlog.getByLabel("Task title: Finish module one exercises")
  ).toBeVisible();
  await expect(page.getByText("0 of 1 tasks complete", { exact: true })).toBeVisible();

  await backlog
    .getByRole("button", { name: "Complete Finish module one exercises" })
    .click();
  await expect(page.getByText("All planned tasks are complete.", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 1 tasks complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page.locator(".project-card").filter({ hasText: "Complete the systems course" }).click();
  await expect(page.locator(".project-metric strong").filter({ hasText: "1/1" })).toBeVisible();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.getByLabel("Phase name: Foundations")).toBeVisible();
});

test("attributes activity, notes, and materials directly to a project", async ({ page }) => {
  await openDashboard(page);
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Research resilient interfaces" }
  });
  expect(projectResponse.ok()).toBe(true);

  await page.reload();
  await page.getByText("Record activity", { exact: true }).click();
  await page.getByPlaceholder("Record a small win or what moved forward.").fill(
    "Mapped the core interface constraints"
  );
  await page.getByLabel("Minutes", { exact: true }).fill("25");
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption({
    label: "Research resilient interfaces"
  });
  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(
    page.locator(".activity-item small").getByText("Research resilient interfaces", {
      exact: true
    })
  ).toBeVisible();

  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByPlaceholder("Capture a thought, decision, or reminder.").fill(
    "Keep the module interface small."
  );
  await page.getByRole("combobox", { name: "Note project" }).selectOption({
    label: "Research resilient interfaces"
  });
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Keep the module interface small.", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Materials", exact: true }).click();
  await page.getByPlaceholder("Title").fill("Interface design notes");
  await page.getByPlaceholder("URL").fill("https://example.com/interfaces");
  await page.getByRole("combobox", { name: "Reference project" }).selectOption({
    label: "Research resilient interfaces"
  });
  await page.getByRole("button", { name: "Save reference" }).click();
  await expect(page.getByText("Interface design notes", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page.locator(".project-card").filter({ hasText: "Research resilient interfaces" }).click();
  await expect(page.getByText("25m", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("Keep the module interface small.", { exact: true })).toBeVisible();
  await expect(page.getByText("Interface design notes", { exact: true })).toBeVisible();
});

test("resolves an unfinished task without silently losing its original date", async ({ page }) => {
  await openDashboard(page);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, "0"),
    String(yesterday.getDate()).padStart(2, "0")
  ].join("-");

  const taskResponse = await page.request.post("/api/tasks", {
    data: { title: "Carry the original plan carefully", date }
  });
  expect(taskResponse.ok()).toBe(true);

  await page.reload();
  await expect(page.getByText("1 unfinished task", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move to today" }).click();
  await expect(taskRow(page, "Carry the original plan carefully")).toBeVisible();
  await page.locator(".schedule-undo").getByRole("button", { name: "Undo" }).click();
  await expect(taskRow(page, "Carry the original plan carefully")).toHaveCount(0);
  await expect(page.getByText("1 unfinished task", { exact: true })).toBeVisible();
});

test("deleting a project detaches rather than deletes its task", async ({ page }) => {
  await openDashboard(page);
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Temporary container" }
  });
  const project = await projectResponse.json();
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Preserve this task",
      projectId: project.id,
      date: new Date().toISOString()
    }
  });
  expect(taskResponse.ok()).toBe(true);

  const deleteResponse = await page.request.delete(`/api/projects/${project.id}?confirm=true`);
  expect(deleteResponse.ok()).toBe(true);
  await page.reload();

  const preservedTask = taskRow(page, "Preserve this task");
  await expect(preservedTask).toBeVisible();
  await expect(preservedTask.locator(".project-chip")).toHaveCount(0);
});

test("keeps mobile navigation visible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openDashboard(page);

  const navItems = page.locator(".nav-list .nav-item");
  await expect(navItems).toHaveCount(4);

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

  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Mobile project" }
  });
  expect(projectResponse.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await expect(page.getByText("Mobile project", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});
