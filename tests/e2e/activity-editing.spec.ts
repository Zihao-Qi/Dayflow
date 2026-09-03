import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { localDateKey, localTime } from "./activity-date-helpers";
import {
  resetTestDatabase,
  setFocusSessionElapsedMinutes
} from "./database";

type Activity = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  category: string;
  note: string;
  origin: "MANUAL" | "FOCUS";
  taskId: string | null;
  projectId: string | null;
  attributedProjectId: string | null;
  focusSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

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

async function openLog(page: Page) {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Log", exact: true, level: 1 })
  ).toBeVisible();
}

async function createProject(request: APIRequestContext, name: string) {
  const response = await request.post("/api/projects", { data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function createManualActivity(
  request: APIRequestContext,
  data: {
    startTime?: string;
    durationMinutes: number;
    category: string;
    note: string;
    taskId?: string | null;
    projectId?: string | null;
  }
) {
  const response = await request.post("/api/activities", { data });
  expect(response.status()).toBe(201);
  return (await response.json()) as Activity;
}

test("edits one manual Activity in place and refreshes derived totals", async ({
  page
}) => {
  const project = await createProject(page.request, "Activity corrections");
  const bootstrap = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { todayKey: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Verify Activity editing",
      date: bootstrap.todayKey,
      projectId: project.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };
  const original = await createManualActivity(page.request, {
    startTime: "09:00",
    durationMinutes: 20,
    category: "Admin",
    note: "Initial Activity evidence",
    taskId: task.id
  });

  await openDashboard(page);
  await openLog(page);
  await page
    .getByRole("button", {
      name: "Edit activity: Initial Activity evidence",
      exact: true
    })
    .click();

  const dialog = page.getByRole("dialog", {
    name: "Edit activity",
    exact: true
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Activity note")).toHaveValue(
    "Initial Activity evidence"
  );
  await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("09:00");
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("20");
  await expect(dialog.getByLabel("Linked task")).toHaveValue(
    task.id
  );
  await expect(dialog.getByLabel("Project", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Project", { exact: true })).toHaveValue(
    project.id
  );

  await dialog.getByLabel("Activity note").fill("Corrected Activity evidence");
  await dialog.getByLabel("Time", { exact: true }).fill("10:15");
  await dialog.getByLabel("Minutes", { exact: true }).fill("35");
  await dialog.getByLabel("Category", { exact: true }).fill("Learning");
  await dialog
    .getByLabel("Linked task")
    .selectOption({ label: "No linked task" });
  await dialog.getByLabel("Project", { exact: true }).selectOption(project.id);

  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/activities/${original.id}` &&
      response.request().method() === "PUT"
  );
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  const response = await updateResponse;
  expect(response.status()).toBe(200);
  const updated = (await response.json()) as Activity;
  expect(updated.id).toBe(original.id);
  expect(updated.createdAt).toBe(original.createdAt);
  expect(localDateKey(updated.startedAt)).toBe(
    localDateKey(original.startedAt)
  );

  await expect(dialog).toHaveCount(0);
  const row = page
    .locator(".stream-row.complete")
    .filter({ hasText: "Corrected Activity evidence" });
  await expect(row).toContainText("35m · Learning");
  await expect(row).toContainText("Activity corrections");
  await expect(page.getByLabel("Today’s log totals")).toContainText(
    "35m recorded"
  );
  await expect(page.getByLabel("Today’s log totals")).toContainText(
    "1 session"
  );

  const after = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { activities: Activity[] };
  expect(after.activities).toHaveLength(1);
  expect(after.activities[0]).toEqual(
    expect.objectContaining({
      id: original.id,
      durationMinutes: 35,
      category: "Learning",
      note: "Corrected Activity evidence",
      taskId: null,
      projectId: project.id,
      attributedProjectId: project.id
    })
  );

  await page.getByRole("button", { name: "Review", exact: true }).click();
  const reviewTotals = page.getByLabel("Review period totals");
  await expect(
    reviewTotals.locator(":scope > div").filter({ hasText: "Recorded" })
  ).toContainText("35m");
  const categories = page.getByRole("list", {
    name: "Activity time by category"
  });
  await expect(categories).toContainText("Learning");
  await expect(categories).toContainText("35m");
});

test("preserves historical attribution until relationships change", async ({
  page
}) => {
  const originalProject = await createProject(
    page.request,
    "Original evidence Project"
  );
  const currentProject = await createProject(
    page.request,
    "Current Task Project"
  );
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Move after evidence",
      date: null,
      projectId: originalProject.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };
  const original = await createManualActivity(page.request, {
    startTime: "11:30",
    durationMinutes: 30,
    category: "Deep Work",
    note: "Evidence before the Task moved",
    taskId: task.id
  });
  expect(original.attributedProjectId).toBe(originalProject.id);

  const moveResponse = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { projectId: currentProject.id, phaseId: null }
  });
  expect(moveResponse.ok()).toBe(true);

  const unchangedRelationships = await page.request.put(
    `/api/activities/${original.id}`,
    {
      data: {
        startTime: "11:45",
        durationMinutes: 40,
        category: "Deep Work",
        note: "Corrected without changing relationships",
        taskId: task.id,
        projectId: null
      }
    }
  );
  expect(unchangedRelationships.status()).toBe(200);
  const preserved = (await unchangedRelationships.json()) as Activity;
  expect(preserved.id).toBe(original.id);
  expect(localDateKey(preserved.startedAt)).toBe(
    localDateKey(original.startedAt)
  );
  expect(preserved.attributedProjectId).toBe(originalProject.id);

  const changedRelationships = await page.request.put(
    `/api/activities/${original.id}`,
    {
      data: {
        startTime: "11:45",
        durationMinutes: 40,
        category: "Deep Work",
        note: "Reattributed after changing relationships",
        taskId: null,
        projectId: currentProject.id
      }
    }
  );
  expect(changedRelationships.status()).toBe(200);
  const reattributed = (await changedRelationships.json()) as Activity;
  expect(reattributed.attributedProjectId).toBe(currentProject.id);

  const retry = await page.request.put(`/api/activities/${original.id}`, {
    data: {
      startTime: "11:45",
      durationMinutes: 40,
      category: "Deep Work",
      note: "Reattributed after changing relationships",
      taskId: null,
      projectId: currentProject.id
    }
  });
  expect(retry.status()).toBe(200);
  expect(((await retry.json()) as Activity).id).toBe(original.id);

  const missingRelationship = await page.request.put(
    `/api/activities/${original.id}`,
    {
      data: {
        startTime: "11:45",
        durationMinutes: 40,
        category: "Deep Work",
        note: "Missing relationship correction",
        taskId: "missing-task",
        projectId: null
      }
    }
  );
  expect(missingRelationship.status()).toBe(404);
  expect(await missingRelationship.json()).toEqual({
    error: "The linked task could not be found.",
    code: "RELATIONSHIP_NOT_FOUND",
    field: "taskId"
  });

  const conflict = await page.request.put(`/api/activities/${original.id}`, {
    data: {
      startTime: "11:45",
      durationMinutes: 40,
      category: "Deep Work",
      note: "Conflicting relationship correction",
      taskId: task.id,
      projectId: originalProject.id
    }
  });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toEqual({
    error: "The selected task belongs to a different project.",
    code: "ATTRIBUTION_CONFLICT",
    field: "projectId"
  });

  const missing = await page.request.put("/api/activities/missing-activity", {
    data: {
      startTime: "11:45",
      durationMinutes: 40,
      category: "Deep Work",
      note: "Missing Activity correction",
      taskId: null,
      projectId: null
    }
  });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({
    error: "Activity not found.",
    code: "ACTIVITY_NOT_FOUND"
  });

  const after = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { activities: Activity[] };
  expect(after.activities).toHaveLength(1);
  expect(after.activities[0].id).toBe(original.id);
});

test("accepts direct Project attribution when a historical Task becomes standalone", async ({
  page
}) => {
  const originalProject = await createProject(
    page.request,
    "Original historical Project"
  );
  const directProject = await createProject(
    page.request,
    "Direct replacement Project"
  );
  const bootstrap = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { todayKey: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Task that became standalone",
      date: bootstrap.todayKey,
      projectId: originalProject.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };
  const original = await createManualActivity(page.request, {
    startTime: "12:30",
    durationMinutes: 30,
    category: "Deep Work",
    note: "Evidence with historical attribution",
    taskId: task.id
  });
  expect(original.projectId).toBeNull();
  expect(original.attributedProjectId).toBe(originalProject.id);

  const detachResponse = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { projectId: null, phaseId: null }
  });
  expect(detachResponse.ok()).toBe(true);

  await openDashboard(page);
  await openLog(page);
  await page
    .getByRole("button", {
      name: "Edit activity: Evidence with historical attribution",
      exact: true
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Edit activity",
    exact: true
  });
  const taskSelect = dialog.getByLabel("Linked task");
  const projectSelect = dialog.getByLabel("Project");
  await expect(projectSelect).toHaveValue(originalProject.id);
  await expect(projectSelect).toBeDisabled();

  await taskSelect.selectOption("");
  await projectSelect.selectOption(directProject.id);
  await taskSelect.selectOption(task.id);
  await expect(projectSelect).toHaveValue(directProject.id);
  await expect(projectSelect).toBeEnabled();
  await dialog
    .getByLabel("Activity note")
    .fill("Evidence with direct attribution");

  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/activities/${original.id}` &&
      response.request().method() === "PUT"
  );
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const response = await updateResponse;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({
      id: original.id,
      taskId: task.id,
      projectId: directProject.id,
      attributedProjectId: directProject.id,
      note: "Evidence with direct attribution"
    })
  );
  await expect(dialog).toHaveCount(0);
});

test("protects Focus evidence from the API and omits its edit control", async ({
  page
}) => {
  const startResponse = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Protected Focus evidence"
    }
  });
  expect(startResponse.status()).toBe(201);
  const { session } = (await startResponse.json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 3);
  const completion = await page.request.patch(
    `/api/focus-session/${session.id}`,
    { data: { action: "complete" } }
  );
  expect(completion.ok()).toBe(true);

  const before = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { activities: Activity[] };
  const activity = before.activities.find(
    (candidate) => candidate.focusSessionId === session.id
  );
  expect(activity).toBeTruthy();

  const update = await page.request.put(`/api/activities/${activity!.id}`, {
    data: {
      startTime: localTime(activity!.startedAt),
      durationMinutes: activity!.durationMinutes,
      category: "Learning",
      note: "Attempted Focus evidence correction",
      taskId: activity!.taskId,
      projectId: activity!.projectId
    }
  });
  expect(update.status()).toBe(409);
  expect(await update.json()).toEqual({
    error: "Focus evidence cannot be edited here.",
    code: "FOCUS_ACTIVITY_PROTECTED"
  });

  const after = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { activities: Activity[] };
  expect(
    after.activities.find((candidate) => candidate.id === activity!.id)
  ).toEqual(activity);

  await openDashboard(page);
  await openLog(page);
  await expect(
    page.getByRole("button", { name: /Edit activity:/ })
  ).toHaveCount(0);
});

test("keeps the edit draft across failed, malformed, and mismatched responses", async ({
  page
}) => {
  const original = await createManualActivity(page.request, {
    startTime: "14:00",
    durationMinutes: 15,
    category: "Admin",
    note: "Activity draft source"
  });
  await openDashboard(page);
  await openLog(page);
  await page
    .getByRole("button", {
      name: "Edit activity: Activity draft source",
      exact: true
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Edit activity",
    exact: true
  });
  await dialog.getByLabel("Activity note").fill("Keep this edit draft");
  await dialog.getByLabel("Minutes", { exact: true }).fill("45");

  let attempt = 0;
  await page.route(`**/api/activities/${original.id}`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({
        status: 500,
        json: { error: "Temporary Activity failure." }
      });
      return;
    }
    if (attempt === 2) {
      await route.fulfill({ status: 200, json: { id: original.id } });
      return;
    }
    const body = route.request().postDataJSON() as {
      durationMinutes: number;
      category: string;
      note: string;
      taskId: string | null;
      projectId: string | null;
    };
    if (attempt === 3) {
      await route.fulfill({
        status: 200,
        json: { ...original, ...body }
      });
      return;
    }
    if (attempt === 4) {
      await route.fulfill({
        status: 200,
        json: {
          ...original,
          ...body,
          createdAt: new Date(
            Date.parse(original.createdAt) - 1_000
          ).toISOString(),
          updatedAt: new Date(
            Date.parse(original.updatedAt) + 1_000
          ).toISOString()
        }
      });
      return;
    }
    if (attempt === 5) {
      await route.fulfill({
        status: 200,
        json: {
          ...original,
          ...body,
          id: "different-activity",
          updatedAt: new Date(
            Date.parse(original.updatedAt) + 1_000
          ).toISOString()
        }
      });
      return;
    }
    await route.continue();
  });

  const save = dialog.getByRole("button", {
    name: "Save changes",
    exact: true
  });
  await save.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Temporary Activity failure."
  );
  await expect(dialog.getByLabel("Activity note")).toHaveValue(
    "Keep this edit draft"
  );
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("45");

  for (let failedAttempt = 0; failedAttempt < 4; failedAttempt += 1) {
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Activity could not be updated. Your draft is still here."
    );
    await expect(dialog.getByLabel("Activity note")).toHaveValue(
      "Keep this edit draft"
    );
  }

  await save.click();
  await expect(dialog).toHaveCount(0);
  const bootstrap = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as { activities: Activity[] };
  expect(bootstrap.activities).toHaveLength(1);
  expect(bootstrap.activities[0]).toEqual(
    expect.objectContaining({
      id: original.id,
      note: "Keep this edit draft",
      durationMinutes: 45
    })
  );
});
