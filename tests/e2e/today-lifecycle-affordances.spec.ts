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
  await expect(page.locator(".today-page")).toBeVisible({ timeout: 30_000 });
}

function taskRow(page: Page, title: string) {
  return page.getByRole("article", { name: `Task: ${title}`, exact: true });
}

async function createProject(
  page: Page,
  name: string,
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED" = "ACTIVE"
) {
  const response = await page.request.post("/api/projects", {
    data: { name }
  });
  expect(response.status()).toBe(201);
  const project = (await response.json()) as { id: string; name: string };
  if (status !== "ACTIVE") {
    const patchRes = await page.request.patch(`/api/projects/${project.id}`, {
      data: { status, confirm: status === "COMPLETED" }
    });
    expect(patchRes.status()).toBe(200);
  }
  return project;
}

async function createTask(
  page: Page,
  data: {
    title: string;
    date?: string | null;
    projectId?: string | null;
    status?: string;
  }
) {
  const response = await page.request.post("/api/tasks", {
    data: {
      title: data.title,
      date: data.date ?? null,
      projectId: data.projectId ?? null,
      estimateMinutes: 30
    }
  });
  expect(response.status()).toBe(201);
  const task = (await response.json()) as { id: string; title: string };
  if (data.status && data.status !== "TODO") {
    const patchRes = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { status: data.status }
    });
    expect(patchRes.status()).toBe(200);
  }
  return task;
}

test("DONE task in a Completed or Archived project disables Mark incomplete and unfinished status options", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  // Create projects as ACTIVE first so we can seed tasks into them
  const completedProj = await createProject(page, "Completed Project", "ACTIVE");
  const archivedProj = await createProject(page, "Archived Project", "ACTIVE");
  const activeProj = await createProject(page, "Active Project", "ACTIVE");

  await createTask(page, {
    title: "Done in Completed",
    projectId: completedProj.id,
    date: todayKey,
    status: "DONE"
  });
  await createTask(page, {
    title: "Done in Archived",
    projectId: archivedProj.id,
    date: todayKey,
    status: "DONE"
  });
  await createTask(page, {
    title: "Done in Active",
    projectId: activeProj.id,
    date: todayKey,
    status: "DONE"
  });

  // Transition projects to COMPLETED and ARCHIVED
  const p1Res = await page.request.patch(`/api/projects/${completedProj.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(p1Res.status()).toBe(200);
  const p2Res = await page.request.patch(`/api/projects/${archivedProj.id}`, {
    data: { status: "ARCHIVED" }
  });
  expect(p2Res.status()).toBe(200);

  await openToday(page);

  const completedGroup = page.locator(".completed-group");
  await expect(completedGroup).toBeVisible();
  await completedGroup.locator("summary").click();

  // Completed project task
  const rowCompleted = taskRow(page, "Done in Completed");
  const checkBtnCompleted = rowCompleted.locator(".check-button");
  await expect(checkBtnCompleted).toBeDisabled();
  await expect(checkBtnCompleted).toHaveAttribute(
    "title",
    "Reopen Completed Project to mark this task incomplete."
  );

  await rowCompleted.getByLabel("Show task details: Done in Completed").click();
  const statusSelectCompleted = rowCompleted.getByLabel("Task status");
  await expect(statusSelectCompleted.locator('option[value="TODO"]')).toHaveJSProperty("disabled", true);
  await expect(statusSelectCompleted.locator('option[value="IN_PROGRESS"]')).toHaveJSProperty("disabled", true);
  await expect(statusSelectCompleted.locator('option[value="DONE"]')).toHaveJSProperty("disabled", false);

  // Archived project task
  const rowArchived = taskRow(page, "Done in Archived");
  const checkBtnArchived = rowArchived.locator(".check-button");
  await expect(checkBtnArchived).toBeDisabled();
  await expect(checkBtnArchived).toHaveAttribute(
    "title",
    "Restore Archived Project to mark this task incomplete."
  );

  await rowArchived.getByLabel("Show task details: Done in Archived").click();
  const statusSelectArchived = rowArchived.getByLabel("Task status");
  await expect(statusSelectArchived.locator('option[value="TODO"]')).toHaveJSProperty("disabled", true);
  await expect(statusSelectArchived.locator('option[value="IN_PROGRESS"]')).toHaveJSProperty("disabled", true);
  await expect(statusSelectArchived.locator('option[value="DONE"]')).toHaveJSProperty("disabled", false);

  // Active project task: stays enabled
  const rowActive = taskRow(page, "Done in Active");
  const checkBtnActive = rowActive.locator(".check-button");
  await expect(checkBtnActive).toBeEnabled();

  await rowActive.getByLabel("Show task details: Done in Active").click();
  const statusSelectActive = rowActive.getByLabel("Task status");
  await expect(statusSelectActive.locator('option[value="TODO"]')).toHaveJSProperty("disabled", false);
  await expect(statusSelectActive.locator('option[value="IN_PROGRESS"]')).toHaveJSProperty("disabled", false);
  await expect(statusSelectActive.locator('option[value="DONE"]')).toHaveJSProperty("disabled", false);
});

test("unfinished standalone task disables Completed and Archived options with status suffix", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  await createProject(page, "Active Project", "ACTIVE");
  await createProject(page, "Paused Project", "PAUSED");
  await createProject(page, "Completed Project", "COMPLETED");
  await createProject(page, "Archived Project", "ARCHIVED");

  await createTask(page, {
    title: "Unfinished standalone task",
    projectId: null,
    date: todayKey,
    status: "TODO"
  });

  await openToday(page);

  const row = taskRow(page, "Unfinished standalone task");
  await row.getByLabel("Show task details: Unfinished standalone task").click();

  const projectSelect = row.getByLabel("Project name");
  const optCompleted = projectSelect.locator("option", { hasText: "Completed Project (Completed)" });
  const optArchived = projectSelect.locator("option", { hasText: "Archived Project (Archived)" });
  const optActive = projectSelect.locator("option", { hasText: "Active Project" });
  const optPaused = projectSelect.locator("option", { hasText: "Paused Project" });

  await expect(optCompleted).toHaveJSProperty("disabled", true);
  await expect(optArchived).toHaveJSProperty("disabled", true);
  await expect(optActive).toHaveJSProperty("disabled", false);
  await expect(optPaused).toHaveJSProperty("disabled", false);
});

test("DONE standalone task keeps closed project options enabled", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  await createProject(page, "Active Project", "ACTIVE");
  await createProject(page, "Paused Project", "PAUSED");
  await createProject(page, "Completed Project", "COMPLETED");
  await createProject(page, "Archived Project", "ARCHIVED");

  await createTask(page, {
    title: "Done standalone task",
    projectId: null,
    date: todayKey,
    status: "DONE"
  });

  await openToday(page);

  const completedGroup = page.locator(".completed-group");
  await expect(completedGroup).toBeVisible();
  await completedGroup.locator("summary").click();

  const row = taskRow(page, "Done standalone task");
  await row.getByLabel("Show task details: Done standalone task").click();

  const projectSelect = row.getByLabel("Project name");
  const optCompleted = projectSelect.locator("option", { hasText: "Completed Project (Completed)" });
  const optArchived = projectSelect.locator("option", { hasText: "Archived Project (Archived)" });
  const optActive = projectSelect.locator("option", { hasText: "Active Project" });
  const optPaused = projectSelect.locator("option", { hasText: "Paused Project" });

  await expect(optCompleted).toHaveJSProperty("disabled", false);
  await expect(optArchived).toHaveJSProperty("disabled", false);
  await expect(optActive).toHaveJSProperty("disabled", false);
  await expect(optPaused).toHaveJSProperty("disabled", false);
});

test("unfinished task already in a closed project keeps its current option enabled and selected", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  const completedProj = await createProject(page, "Closed With Unfinished", "ACTIVE");
  await createProject(page, "Other Archived", "ARCHIVED");

  await createTask(page, {
    title: "Unfinished in closed",
    projectId: completedProj.id,
    date: todayKey,
    status: "TODO"
  });

  const patchRes = await page.request.patch(`/api/projects/${completedProj.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(patchRes.status()).toBe(200);

  await openToday(page);

  const row = taskRow(page, "Unfinished in closed");
  await row.getByLabel("Show task details: Unfinished in closed").click();

  const projectSelect = row.getByLabel("Project name");
  await expect(projectSelect).toHaveValue(completedProj.id);

  const currentOption = projectSelect.locator(`option[value="${completedProj.id}"]`);
  await expect(currentOption).toContainText("Closed With Unfinished (Completed)");
  await expect(currentOption).toHaveJSProperty("disabled", false);

  const otherOption = projectSelect.locator("option", { hasText: "Other Archived (Archived)" });
  await expect(otherOption).toHaveJSProperty("disabled", true);

  const statusSelect = row.getByLabel("Task status");
  await expect(statusSelect.locator('option[value="TODO"]')).toHaveJSProperty("disabled", false);
  await expect(statusSelect.locator('option[value="IN_PROGRESS"]')).toHaveJSProperty("disabled", false);
  await expect(statusSelect.locator('option[value="DONE"]')).toHaveJSProperty("disabled", false);
});

test("T1: failed Complete keeps row in open list with enabled Complete button", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  const completedProj = await createProject(page, "Completed T1", "ACTIVE");
  const task = await createTask(page, {
    title: "Unfinished T1",
    projectId: completedProj.id,
    date: todayKey,
    status: "TODO"
  });
  const patchProjRes = await page.request.patch(`/api/projects/${completedProj.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(patchProjRes.status()).toBe(200);

  await openToday(page);

  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, json: { error: "Simulated failure" } });
      return;
    }
    await route.continue();
  });

  const row = taskRow(page, "Unfinished T1");
  await row.getByRole("button", { name: "Complete Unfinished T1" }).click();

  await expect(page.locator(".sr-only[role='status']")).toHaveText("Changes were not saved.", {
    timeout: 10_000
  });

  const openRow = taskRow(page, "Unfinished T1");
  await expect(openRow).toBeVisible();
  await expect(page.locator(".completed-group")).toBeHidden();

  const completeBtn = openRow.getByRole("button", { name: "Complete Unfinished T1" });
  await expect(completeBtn).toBeVisible();
  await expect(completeBtn).toBeEnabled();

  const bootAfter = (await (await page.request.get("/api/bootstrap")).json()) as {
    tasks: Array<{ id: string; status: string }>;
  };
  expect(bootAfter.tasks.find((t) => t.id === task.id)?.status).toBe("TODO");
});

test("T2: failed status select keeps row in open list with error chip and enabled options", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  const completedProj = await createProject(page, "Completed T2", "ACTIVE");
  const task = await createTask(page, {
    title: "Unfinished T2",
    projectId: completedProj.id,
    date: todayKey,
    status: "TODO"
  });
  const patchProjRes = await page.request.patch(`/api/projects/${completedProj.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(patchProjRes.status()).toBe(200);

  await openToday(page);

  const row = taskRow(page, "Unfinished T2");
  await row.getByLabel("Show task details: Unfinished T2").click();

  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, json: { error: "Simulated failure" } });
      return;
    }
    await route.continue();
  });

  const statusSelect = row.getByLabel("Task status");
  await statusSelect.selectOption("DONE");

  const openRow = taskRow(page, "Unfinished T2");
  await expect(openRow).toBeVisible();
  await expect(page.locator(".completed-group")).toBeHidden();

  const statusChip = openRow
    .getByLabel("Task status")
    .locator("xpath=ancestor::label")
    .locator(".save-state-chip.error");
  await expect(statusChip).toContainText("Not saved", { timeout: 10_000 });
  await expect(statusChip.locator("button")).toContainText("Retry");

  await expect(statusSelect.locator('option[value="TODO"]')).toHaveJSProperty("disabled", false);
  await expect(statusSelect.locator('option[value="IN_PROGRESS"]')).toHaveJSProperty("disabled", false);

  const bootAfter = (await (await page.request.get("/api/bootstrap")).json()) as {
    tasks: Array<{ id: string; status: string }>;
  };
  expect(bootAfter.tasks.find((t) => t.id === task.id)?.status).toBe("TODO");
});

test("T3: failed project move leaves original project option enabled with error chip", async ({
  page
}) => {
  const boot = (await (await page.request.get("/api/bootstrap")).json()) as {
    todayKey: string;
  };
  const todayKey = boot.todayKey;

  const completedProj = await createProject(page, "Completed T3", "ACTIVE");
  const activeProj = await createProject(page, "Active T3", "ACTIVE");

  const task = await createTask(page, {
    title: "Unfinished T3",
    projectId: completedProj.id,
    date: todayKey,
    status: "TODO"
  });
  const patchProjRes = await page.request.patch(`/api/projects/${completedProj.id}`, {
    data: { status: "COMPLETED", confirm: true }
  });
  expect(patchProjRes.status()).toBe(200);

  await openToday(page);

  const row = taskRow(page, "Unfinished T3");
  await row.getByLabel("Show task details: Unfinished T3").click();

  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, json: { error: "Simulated failure" } });
      return;
    }
    await route.continue();
  });

  const projectSelect = row.getByLabel("Project name");
  await projectSelect.selectOption(activeProj.id);

  const projectChip = row
    .getByLabel("Project name")
    .locator("xpath=ancestor::label")
    .locator(".save-state-chip.error");
  await expect(projectChip).toContainText("Not saved", { timeout: 10_000 });
  await expect(projectChip.locator("button")).toContainText("Retry");

  const originalOption = projectSelect.locator(`option[value="${completedProj.id}"]`);
  await expect(originalOption).toHaveJSProperty("disabled", false);

  const bootAfter = (await (await page.request.get("/api/bootstrap")).json()) as {
    tasks: Array<{ id: string; projectId: string | null }>;
  };
  expect(bootAfter.tasks.find((t) => t.id === task.id)?.projectId).toBe(completedProj.id);
});
