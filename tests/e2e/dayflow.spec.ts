import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, setFocusSessionElapsedMinutes } from "./database";

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

async function addTask(page: Page, title: string) {
  await page.getByPlaceholder("Add a task for today").fill(title);
  const createTask = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createTask).ok()).toBe(true);
  await expect(taskRow(page, title)).toBeVisible();
}

async function addBacklogTask(page: Page, title: string) {
  const response = await page.request.post("/api/tasks", {
    data: {
      title,
      date: null,
      estimateMinutes: 30,
      urgentScore: 4,
      importanceScore: 4
    }
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /blocks? left$/ })).toBeVisible();
}

function taskRow(page: Page, title: string) {
  return page.getByRole("article", { name: `Task: ${title}`, exact: true });
}

test("uses the redesigned navigation, command palette, and contextual focus rail", async ({
  page
}) => {
  await openDashboard(page);

  await expect(page.locator(".nav-list .nav-item:not(.mobile-more)")).toHaveCount(6);
  await expect(page.getByRole("complementary", { name: "Focus rail" })).toBeVisible();

  await page.getByRole("button", { name: /Search or add/ }).click();
  const palette = page.getByRole("dialog", { name: "Search or add" });
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Start a 50m focus block", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
  await expect(page.getByLabel("Today’s log totals")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Focus rail" })).toHaveCount(0);

  await page.getByRole("button", { name: /Start focus/ }).click();
  await expect(page.getByRole("complementary", { name: "Focus rail" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Focus rail" })).toHaveCount(0);
});

test("persists task editing, completion, and accessible ordering", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "First task");
  await addTask(page, "Second task");

  const firstRow = taskRow(page, "First task");
  const titleInput = firstRow.getByLabel("Task title: First task");
  await titleInput.fill("Edited first task");
  await titleInput.press("Enter");
  const editedRow = taskRow(page, "Edited first task");
  await expect(editedRow.getByText("Saved", { exact: true })).toBeVisible();
  await editedRow
    .getByRole("button", { name: "Complete Edited first task" })
    .click();
  await expect(page.getByText("Done today · 1", { exact: true })).toBeVisible();

  await page.getByText("Done today · 1", { exact: true }).click();
  await expect(
    taskRow(page, "Edited first task").getByRole("button", {
      name: "Mark Edited first task incomplete"
    })
  ).toBeVisible();
  await taskRow(page, "Edited first task")
    .getByRole("button", { name: "Mark Edited first task incomplete" })
    .click();

  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  await expect(page.getByText(/Reordering. Drag a row/)).toBeVisible();
  const reorder = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/reorder") &&
      response.request().method() === "POST"
  );
  await taskRow(page, "Edited first task")
    .getByRole("button", { name: "Move Edited first task down" })
    .click();
  expect((await reorder).ok()).toBe(true);
  await expect(
    page.getByText('Moved "Edited first task" to position 2 of 2.', {
      exact: true
    })
  ).toBeAttached();

  await expect
    .poll(() =>
      page.locator(".task-list .task-title-input").evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value)
      )
    )
    .toEqual(["Second task", "Edited first task"]);

  await page.reload();
  await expect
    .poll(() =>
      page.locator(".task-list .task-title-input").evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value)
      )
    )
    .toEqual(["Second task", "Edited first task"]);
});

test("persists a focus session in the rail and collapses it to a strip", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Write the focus rail test");

  const row = taskRow(page, "Write the focus rail test");
  await row.getByRole("button", { name: "Focus 30m", exact: true }).click();
  await expect(page.getByLabel("Focus task").locator("option:checked")).toHaveText(
    "Write the focus rail test"
  );
  await page.getByLabel("Custom focus minutes").fill("5");
  await page.getByPlaceholder("What will you move forward?").fill("Verify the persistent rail");

  const startFocus = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Start 5m focus" }).click();
  const startResponse = await startFocus;
  expect(startResponse.ok()).toBe(true);
  const { session } = (await startResponse.json()) as { session: { id: string } };

  const fullRail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(
    fullRail.getByRole("heading", { name: "Write the focus rail test" })
  ).toBeVisible();
  await expect(fullRail.getByText(/Verify the persistent rail/)).toBeVisible();

  await page.getByRole("button", { name: "Log", exact: true }).click();
  const strip = page.getByRole("complementary", { name: "Active focus session" });
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "Pause timer", exact: true }).click();
  await expect(strip.getByRole("button", { name: "Resume timer", exact: true })).toBeVisible();

  await page.reload();
  const reloadedRail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(reloadedRail.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(
    reloadedRail.getByText(/Nothing is being recorded\./)
  ).toBeVisible();
  await expect(reloadedRail.getByText(/of this block is safe/)).toBeVisible();

  setFocusSessionElapsedMinutes(session.id, 2);
  await reloadedRail.getByRole("button", { name: "Resume", exact: true }).click();
  await reloadedRail.getByRole("button", { name: "Finish", exact: true }).click();

  await expect(reloadedRail.getByRole("heading", { name: "2m done" })).toBeVisible();
  await reloadedRail
    .getByPlaceholder("One line is enough — it becomes today’s activity record.")
    .fill("Verified the persistent completion record");
  await reloadedRail.getByRole("button", { name: "Still going" }).click();
  await reloadedRail.getByRole("button", { name: "Save and take a 2m break" }).click();
  await expect(reloadedRail.getByText("Nothing is being recorded.")).toBeVisible();
  await expect(reloadedRail.getByRole("heading", { name: "Break" })).toBeVisible();
  await expect(
    reloadedRail.locator(".rail-focus-clock span").getByText("2m", { exact: true })
  ).toBeVisible();
});

test("records activity through the palette and shows it in the rail", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Capture activity evidence");

  await page.getByRole("button", { name: /Search or add/ }).click();
  await page.getByRole("button", { name: /Log an activity by hand/ }).click();
  const dialog = page.getByRole("dialog", { name: "Log activity" });
  await dialog.getByRole("button", { name: "Add activity" }).click();
  await expect(dialog.getByText("Add a short note about what happened.")).toBeVisible();

  await dialog
    .getByPlaceholder("Record a small win or what moved forward.")
    .fill("Mapped the new focus flow");
  await dialog.getByLabel("Minutes", { exact: true }).fill("20");
  await dialog.getByLabel("Linked task").selectOption({ label: "Capture activity evidence" });
  await dialog.getByRole("button", { name: "Add activity" }).click();

  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(rail.getByText("Mapped the new focus flow", { exact: true })).toBeVisible();
  await expect(rail.getByText("20m · Deep Work", { exact: true })).toBeVisible();
});

test("uses one Backlog with four arrangements and persistent task elements", async ({
  page
}) => {
  await openDashboard(page);
  await addBacklogTask(page, "Place on matrix");

  await page.getByRole("button", { name: /Backlog/ }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Arrange backlog by" })
  ).toBeVisible();
  await expect(page.getByText("Tables — act here: schedule, focus, relabel.")).toBeVisible();
  await expect(page.getByText("Do now", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Schedule", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Quick wins", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Later", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Place on matrix, Standalone/ })).toBeVisible();

  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await expect(page.getByText("Figure — read here; hover a dot for its title.")).toBeVisible();
  await page.getByRole("button", { name: /Place on matrix, Standalone/ }).click();
  await expect(
    page.locator(".matrix-selection-caption").getByText("Place on matrix", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator(".matrix-selection-caption").getByRole("button", { name: "Today" })
  ).toBeVisible();
});

test("explains an empty backlog and hides Arrange", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Backlog/ }).click();

  await expect(
    page.getByRole("heading", { name: "Everything defined has a day" })
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Arrange backlog by" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Capture something · ⌘K" })
  ).toBeVisible();
});

test("creates a project, keeps its plan on one page, and unifies its backlog", async ({
  page
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel(/Name required/).fill("Complete the systems course");
  await page.getByRole("button", { name: "6 weeks", exact: true }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(
    page.getByRole("heading", { name: "Complete the systems course", exact: true })
  ).toBeVisible();
  await expect(page.getByText("6 weeks expected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editProject = page.getByRole("dialog", {
    name: "Edit Complete the systems course"
  });
  await expect(editProject.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await editProject.getByLabel("Name", { exact: true }).fill("Complete systems course");
  await expect(editProject.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await editProject.getByRole("button", { name: "Save changes" }).click();
  await expect(editProject).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Complete systems course",
      exact: true
    })
  ).toBeVisible();

  await page.getByRole("button", { name: "Add a phase", exact: true }).click();
  await page.getByPlaceholder("Add an optional phase").fill("Foundations");
  await page.getByRole("button", { name: "Add phase" }).click();
  await expect(page.getByLabel("Phase name: Foundations")).toBeVisible();

  const addTaskPanel = page.locator(".project-plan-add");
  await addTaskPanel.getByLabel("New Project task").fill("Finish module one exercises");
  await addTaskPanel.getByLabel("Task phase").selectOption({ label: "Foundations" });
  await addTaskPanel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByLabel("Phase name: Foundations") })
      .getByLabel("Task title: Finish module one exercises")
  ).toBeVisible();
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByLabel("Phase name: Foundations") })
      .getByText("Backlog", { exact: true })
  ).toBeVisible();

  await page
    .getByRole("button", { name: /^Backlog 1 Unscheduled tasks/ })
    .click();
  await expect(page.getByRole("radio", { name: "Project" })).toBeChecked();
  await expect(page.getByText("Complete systems course first", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Finish module one exercises, Complete systems course/
    })
  ).toBeVisible();
});

test("supports the redesigned Journal and Review destinations", async ({ page }) => {
  await openDashboard(page);

  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notes · 0", exact: true }).click();
  await page
    .getByPlaceholder("Capture a thought, decision, or reminder.")
    .fill("Keep the interface calm.");
  const saveNote = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  expect((await saveNote).ok()).toBe(true);
  await expect(page.getByText("Keep the interface calm.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "References · 0", exact: true }).click();
  await page.getByPlaceholder("Title").fill("Interface notes");
  await page.getByPlaceholder("URL").fill("https://example.com/interface-notes");
  const saveReference = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/materials") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  expect((await saveReference).ok()).toBe(true);
  await expect(page.getByText("Interface notes", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where the focus went" })).toBeVisible();
  await expect(page.getByText("Planned vs focused", { exact: true })).toBeVisible();
});

test("uses five mobile tabs, keeps touch targets large, and puts secondary places under More", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  const navItems = page.locator(".nav-list .nav-item:visible");
  await expect(navItems).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Log", exact: true })).toBeVisible();
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
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

  await addBacklogTask(page, "Phone matrix item");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("menu", { name: "More destinations" });
  await expect(more.getByRole("menuitem", { name: /Backlog/ })).toBeVisible();
  await expect(more.getByRole("menuitem", { name: "Journal" })).toBeVisible();
  await more.getByRole("menuitem", { name: /Backlog/ }).click();
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "More", exact: true }).click();
  const reopenedMore = page.getByRole("menu", { name: "More destinations" });
  await reopenedMore.getByRole("menuitem", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
});

test("keeps phone, tablet, and desktop navigation modes exclusive at their boundaries", async ({
  page
}) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await openDashboard(page);

  const navigation = page.getByRole("navigation", { name: "Primary" });
  const sidebar = page.locator(".sidebar");
  const workspace = page.locator(".workspace");

  for (const width of [390, 620]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".nav-list .nav-item:visible")).toHaveCount(5);
    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(Math.round(navigationBox?.width ?? 0)).toBe(width);
  }

  for (const width of [621, 700, 780, 781, 900, 1179]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".nav-list .nav-item:visible")).toHaveCount(6);
    const navigationBox = await navigation.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    const workspaceBox = await workspace.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    expect(navigationBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(68);
    expect(Math.round(sidebarBox?.width ?? 0)).toBe(68);
    expect(navigationBox?.x ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      (sidebarBox?.x ?? 0) - 1
    );
    expect(
      (navigationBox?.x ?? 0) + (navigationBox?.width ?? Number.POSITIVE_INFINITY)
    ).toBeLessThanOrEqual(
      (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0) + 1
    );
    expect((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0)).toBeLessThanOrEqual(
      (workspaceBox?.x ?? 0) + 1
    );
  }

  await page.setViewportSize({ width: 1180, height: 900 });
  const desktopSidebarBox = await sidebar.boundingBox();
  const desktopWorkspaceBox = await workspace.boundingBox();
  expect(Math.round(desktopSidebarBox?.width ?? 0)).toBe(196);
  expect(
    (desktopSidebarBox?.x ?? 0) + (desktopSidebarBox?.width ?? 0)
  ).toBeLessThanOrEqual((desktopWorkspaceBox?.x ?? 0) + 1);
});

test("uses the 68px tablet rails and keeps captured activity in Today", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openDashboard(page);
  await addTask(page, "Tablet focus block");
  await taskRow(page, "Tablet focus block")
    .getByRole("button", { name: "Focus 30m" })
    .click();

  const sidebar = page.locator(".sidebar");
  const strip = page.getByRole("complementary", { name: "Active focus session" });
  await expect(strip).toBeVisible();
  await expect(page.locator(".tablet-captured-card")).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  const stripBox = await strip.boundingBox();
  expect(Math.round(sidebarBox?.width ?? 0)).toBe(68);
  expect(Math.round(stripBox?.width ?? 0)).toBe(68);

  await addBacklogTask(page, "Tablet matrix item");
  await page.getByRole("button", { name: /Backlog/ }).click();
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeVisible();
});
