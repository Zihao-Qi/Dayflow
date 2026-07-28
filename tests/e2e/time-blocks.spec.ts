import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedMalformedTimeBlock,
  seedPreviousDayTimeBlockReceipt,
  setCompletedFocusSessionInterval
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

async function openTimeline(page: Page) {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add time block", exact: true })
  ).toBeVisible();
}

function addDialog(page: Page) {
  return page.getByRole("dialog", { name: "Add time block", exact: true });
}

function editDialog(page: Page) {
  return page.getByRole("dialog", { name: "Edit time block", exact: true });
}

function timeBlock(page: Page, title: string, start: string, end: string) {
  return page.getByRole("button", {
    name: `Time block: ${title}, ${start} to ${end}`,
    exact: true
  });
}

async function openAddDialog(page: Page) {
  await page
    .getByRole("button", { name: "Add time block", exact: true })
    .click();
  const dialog = addDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillBlock(
  dialog: ReturnType<Page["getByRole"]>,
  {
    title,
    start,
    end
  }: {
    title: string;
    start: string;
    end: string;
  }
) {
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Start", { exact: true }).fill(start);
  await dialog.getByLabel("End", { exact: true }).fill(end);
}

async function addFreeformBlock(
  page: Page,
  title: string,
  start: string,
  end: string
) {
  const dialog = await openAddDialog(page);
  await fillBlock(dialog, { title, start, end });
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/time-blocks" &&
      candidate.request().method() === "POST"
  );
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  expect((await response).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(timeBlock(page, title, start, end)).toBeVisible();
}

test("persists a freeform Time Block through full editing and confirmed deletion", async ({
  page
}) => {
  await openDashboard(page);
  await openTimeline(page);
  await addFreeformBlock(page, "Write release notes", "09:00", "10:00");

  await page.reload();
  await openTimeline(page);
  await expect(
    timeBlock(page, "Write release notes", "09:00", "10:00")
  ).toBeVisible();

  await timeBlock(page, "Write release notes", "09:00", "10:00").click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  await fillBlock(dialog, {
    title: "Polish release notes",
    start: "09:15",
    end: "10:30"
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    timeBlock(page, "Polish release notes", "09:15", "10:30")
  ).toBeVisible();

  await page.reload();
  await openTimeline(page);
  await timeBlock(page, "Polish release notes", "09:15", "10:30").click();
  const deleteDialog = editDialog(page);
  await deleteDialog
    .getByRole("button", { name: "Delete block", exact: true })
    .click();
  await expect(
    deleteDialog.getByRole("button", { name: "Keep block", exact: true })
  ).toBeFocused();
  await deleteDialog
    .getByRole("button", { name: "Delete block", exact: true })
    .click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(
    timeBlock(page, "Polish release notes", "09:15", "10:30")
  ).toHaveCount(0);

  await page.reload();
  await openTimeline(page);
  await expect(
    timeBlock(page, "Polish release notes", "09:15", "10:30")
  ).toHaveCount(0);
});

test("prefills a Task-linked draft from its title and estimate while keeping it editable", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Prepare launch brief",
      date: today,
      estimateMinutes: 45
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };
  const alternativeResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Alternative launch Task",
      date: today,
      estimateMinutes: 30
    }
  });
  expect(alternativeResponse.status()).toBe(201);
  const alternativeTask = (await alternativeResponse.json()) as {
    id: string;
  };

  await openDashboard(page);
  await openTimeline(page);
  await page
    .getByRole("button", {
      name: "Block time for Prepare launch brief",
      exact: true
    })
    .click();

  const dialog = addDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Prepare launch brief"
  );
  await expect(dialog.getByLabel("Linked task", { exact: true })).toHaveValue(
    task.id
  );
  const start = await dialog.getByLabel("Start", { exact: true }).inputValue();
  const end = await dialog.getByLabel("End", { exact: true }).inputValue();
  expect(timeMinutes(end) - timeMinutes(start)).toBe(45);

  await fillBlock(dialog, {
    title: "Draft only the launch outline",
    start: "13:00",
    end: "14:00"
  });
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  await openTimeline(page);
  await expect(
    timeBlock(page, "Draft only the launch outline", "13:00", "14:00")
  ).toBeVisible();

  const completed = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { status: "DONE" }
  });
  expect(completed.ok()).toBe(true);
  await page.reload();
  await openTimeline(page);
  await timeBlock(
    page,
    "Draft only the launch outline",
    "13:00",
    "14:00"
  ).click();
  const retainedLinkDialog = editDialog(page);
  await retainedLinkDialog
    .getByLabel("Title", { exact: true })
    .fill("Keep the completed Task link");
  await retainedLinkDialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(retainedLinkDialog).toHaveCount(0);
  await expect(
    timeBlock(page, "Keep the completed Task link", "13:00", "14:00")
  ).toBeVisible();

  const moved = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { date: offsetLocalDateKey(today, 60) }
  });
  expect(moved.ok()).toBe(true);
  await page.reload();
  await openTimeline(page);
  await timeBlock(
    page,
    "Keep the completed Task link",
    "13:00",
    "14:00"
  ).click();
  const clearLinkDialog = editDialog(page);
  await expect(
    clearLinkDialog.getByLabel("Linked task", { exact: true })
  ).toHaveValue(task.id);
  await expect(
    clearLinkDialog.getByRole("option", {
      name: "Prepare launch brief · 45m",
      exact: true
    })
  ).toHaveCount(1);
  await clearLinkDialog
    .getByLabel("Linked task", { exact: true })
    .selectOption(alternativeTask.id);
  await expect(
    clearLinkDialog.getByLabel("Linked task", { exact: true })
  ).toHaveValue(alternativeTask.id);
  await clearLinkDialog
    .getByLabel("Linked task", { exact: true })
    .selectOption(task.id);
  await expect(
    clearLinkDialog.getByLabel("Linked task", { exact: true })
  ).toHaveValue(task.id);
  await clearLinkDialog
    .getByLabel("Linked task", { exact: true })
    .selectOption("");
  await clearLinkDialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(clearLinkDialog).toHaveCount(0);

  const persisted = await page.request.get("/api/bootstrap");
  expect(persisted.ok()).toBe(true);
  const persistedBlock = (
    (await persisted.json()) as {
      timeBlocks: Array<{
        startTime: string;
        endTime: string;
        taskId: string | null;
      }>;
    }
  ).timeBlocks.find(
    (block) => block.startTime === "13:00" && block.endTime === "14:00"
  );
  expect(persistedBlock?.taskId).toBeNull();
});

test("rejects overlapping Time Blocks and preserves the complete draft", async ({
  page
}) => {
  await openDashboard(page);
  await openTimeline(page);
  await addFreeformBlock(page, "Protected interval", "09:00", "10:00");

  const dialog = await openAddDialog(page);
  await fillBlock(dialog, {
    title: "Keep this overlapping draft",
    start: "09:30",
    end: "10:30"
  });
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/overlap|conflict/i);
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Keep this overlapping draft"
  );
  await expect(dialog.getByLabel("Start", { exact: true })).toHaveValue("09:30");
  await expect(dialog.getByLabel("End", { exact: true })).toHaveValue("10:30");
  await expect(
    timeBlock(page, "Keep this overlapping draft", "09:30", "10:30")
  ).toHaveCount(0);

  await dialog.getByLabel("Start", { exact: true }).fill("10:00");
  await dialog.getByLabel("End", { exact: true }).fill("10:30");
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    timeBlock(page, "Keep this overlapping draft", "10:00", "10:30")
  ).toBeVisible();
  const protectedBox = await timeBlock(
    page,
    "Protected interval",
    "09:00",
    "10:00"
  ).boundingBox();
  const adjacentBox = await timeBlock(
    page,
    "Keep this overlapping draft",
    "10:00",
    "10:30"
  ).boundingBox();
  expect(protectedBox).not.toBeNull();
  expect(adjacentBox).not.toBeNull();
  expect(adjacentBox?.height ?? 0).toBeGreaterThanOrEqual(24);
  expect(
    (protectedBox?.y ?? 0) + (protectedBox?.height ?? 0)
  ).toBeLessThanOrEqual((adjacentBox?.y ?? 0) + 1);
});

test("rejects missing, completed, and unscheduled Task links", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const completedResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Already finished",
      date: today,
      status: "DONE"
    }
  });
  const backlogResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Still in the backlog",
      date: null
    }
  });
  expect(completedResponse.status()).toBe(201);
  expect(backlogResponse.status()).toBe(201);
  const completedTask = (await completedResponse.json()) as { id: string };
  const backlogTask = (await backlogResponse.json()) as { id: string };

  for (const taskId of [completedTask.id, backlogTask.id]) {
    const response = await page.request.post("/api/time-blocks", {
      data: {
        date: today,
        startTime: "11:00",
        endTime: "11:30",
        title: "Invalid linked block",
        taskId
      }
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("RELATIONSHIP_CONFLICT");
  }

  const missing = await page.request.post("/api/time-blocks", {
    data: {
      date: today,
      startTime: "11:00",
      endTime: "11:30",
      title: "Missing linked block",
      taskId: "missing-time-block-task"
    }
  });
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe("RELATIONSHIP_NOT_FOUND");
});

test("does not treat recorded Activity or Focus as a planned-time conflict", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const activity = await page.request.post("/api/activities", {
    data: {
      date: today,
      startTime: "09:15",
      durationMinutes: 30,
      category: "Deep Work",
      note: "Recorded work may overlap the plan"
    }
  });
  expect(activity.status()).toBe(201);

  const focus = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 30,
      label: "Recorded focus may overlap the plan"
    }
  });
  expect(focus.status()).toBe(201);
  const focusSession = (await focus.json()) as { session: { id: string } };
  setCompletedFocusSessionInterval(
    focusSession.session.id,
    today,
    "09:15",
    "09:45"
  );

  const block = await page.request.post("/api/time-blocks", {
    data: {
      date: today,
      startTime: "09:00",
      endTime: "10:00",
      title: "Plan over evidence",
      taskId: null
    }
  });
  expect(block.status()).toBe(201);

  await openDashboard(page);
  await openTimeline(page);
  await expect(
    timeBlock(page, "Plan over evidence", "09:00", "10:00")
  ).toBeVisible();
});

test("keeps a Task selection and full draft after malformed success JSON", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Preserve this Task selection",
      date: today,
      estimateMinutes: 45
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };

  await openDashboard(page);
  await openTimeline(page);
  await page
    .getByRole("button", {
      name: "Block time for Preserve this Task selection",
      exact: true
    })
    .click();
  const dialog = addDialog(page);
  await fillBlock(dialog, {
    title: "Do not clear this draft",
    start: "14:00",
    end: "14:45"
  });

  await page.route("**/api/time-blocks", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        json: {
          id: "",
          date: `${today}-garbage`,
          startTime: "14:00",
          endTime: "14:45",
          title: "Do not clear this draft",
          taskId: task.id,
          createdAt: new Date().toISOString(),
          task: {
            id: task.id,
            title: "Preserve this Task selection",
            estimateMinutes: 45
          }
        }
      });
      return;
    }
    await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Do not clear this draft"
  );
  await expect(dialog.getByLabel("Start", { exact: true })).toHaveValue("14:00");
  await expect(dialog.getByLabel("End", { exact: true })).toHaveValue("14:45");
  await expect(
    dialog.getByLabel("Linked task", { exact: true })
  ).toHaveValue(task.id);
  await expect(dialog.getByRole("alert")).toContainText(/not saved|could not/i);
  await expect(
    timeBlock(page, "Do not clear this draft", "14:00", "14:45")
  ).toHaveCount(0);
});

test("keeps an edit draft open when success JSON names another Time Block", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  await openDashboard(page);
  await openTimeline(page);
  await addFreeformBlock(page, "Keep the original record", "14:00", "14:45");
  await timeBlock(page, "Keep the original record", "14:00", "14:45").click();

  const dialog = editDialog(page);
  await fillBlock(dialog, {
    title: "Do not close this edit",
    start: "14:15",
    end: "15:00"
  });
  await page.route("**/api/time-blocks/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 200,
        json: {
          id: "another-time-block",
          date: today,
          startTime: "14:15",
          endTime: "15:00",
          title: "Do not close this edit",
          taskId: null,
          createdAt: new Date().toISOString(),
          task: null
        }
      });
      return;
    }
    await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Do not close this edit"
  );
  await expect(dialog.getByLabel("Start", { exact: true })).toHaveValue("14:15");
  await expect(dialog.getByLabel("End", { exact: true })).toHaveValue("15:00");
  await expect(dialog.getByRole("alert")).toContainText(/not saved|could not/i);
  await expect(
    timeBlock(page, "Keep the original record", "14:00", "14:45")
  ).toBeVisible();
});

test("keeps the saved draft available when the confirmed refresh fails", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Keep after refresh failure",
      date: today,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };

  await openDashboard(page);
  await openTimeline(page);
  await page
    .getByRole("button", {
      name: "Block time for Keep after refresh failure",
      exact: true
    })
    .click();
  const dialog = addDialog(page);
  await fillBlock(dialog, {
    title: "Saved values stay available",
    start: "15:00",
    end: "15:30"
  });

  let failedRefresh = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (!failedRefresh) {
      failedRefresh = true;
      await route.fulfill({
        status: 503,
        json: { error: "Refresh unavailable" }
      });
      return;
    }
    await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();

  const preserved = editDialog(page);
  await expect(preserved).toBeVisible();
  await expect(preserved.getByLabel("Title", { exact: true })).toHaveValue(
    "Saved values stay available"
  );
  await expect(preserved.getByLabel("Start", { exact: true })).toHaveValue(
    "15:00"
  );
  await expect(preserved.getByLabel("End", { exact: true })).toHaveValue(
    "15:30"
  );
  await expect(
    preserved.getByLabel("Linked task", { exact: true })
  ).toHaveValue(task.id);
  await expect(preserved.getByRole("alert")).toContainText(
    /saved.*could not be refreshed/i
  );

  const persisted = await page.request.get("/api/bootstrap");
  expect(persisted.ok()).toBe(true);
  expect(
    (
      (await persisted.json()) as {
        timeBlocks: Array<{ title: string }>;
      }
    ).timeBlocks.some((block) => block.title === "Saved values stay available")
  ).toBe(true);
});

test("ignores a malformed legacy Time Block without crashing Timeline", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  seedMalformedTimeBlock(today);

  await openDashboard(page);
  await openTimeline(page);
  await expect(
    page.getByRole("button", { name: "Add time block", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Time block:/ })
  ).toHaveCount(0);
  await addFreeformBlock(
    page,
    "Valid plan over hidden legacy data",
    "09:15",
    "09:30"
  );
});

test("rejects non-today writes and missing Time Block deletes", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const tomorrow = offsetLocalDateKey(today, 1);
  const future = await page.request.post("/api/time-blocks", {
    data: {
      date: tomorrow,
      startTime: "10:00",
      endTime: "10:30",
      title: "Not part of today",
      taskId: null
    }
  });
  expect(future.status()).toBe(400);
  expect(await future.json()).toMatchObject({
    code: "VALIDATION_ERROR",
    field: "date"
  });

  const missingDelete = await page.request.delete(
    "/api/time-blocks/missing-time-block"
  );
  expect(missingDelete.status()).toBe(404);
  expect((await missingDelete.json()).code).toBe("NOT_FOUND");
});

test("replays an idempotent Time Block create without duplicating it", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const headers = { "X-Dayflow-Mutation-Id": "e2e-time-block-create-1" };
  const data = {
    date: today,
    startTime: "15:00",
    endTime: "15:30",
    title: "Create exactly once",
    taskId: null
  };

  const first = await page.request.post("/api/time-blocks", { data, headers });
  const replay = await page.request.post("/api/time-blocks", { data, headers });
  expect(first.status()).toBe(201);
  expect(replay.status()).toBe(201);
  expect((await replay.json()).id).toBe((await first.json()).id);

  const conflict = await page.request.post("/api/time-blocks", {
    data: { ...data, title: "Different logical request" },
    headers
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).code).toBe("MUTATION_ID_CONFLICT");

  await openDashboard(page);
  await openTimeline(page);
  await expect(
    timeBlock(page, "Create exactly once", "15:00", "15:30")
  ).toHaveCount(1);
  await expect(
    timeBlock(page, "Different logical request", "15:00", "15:30")
  ).toHaveCount(0);
});

test("replays a Time Block create receipt after its local day has ended", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const seeded = seedPreviousDayTimeBlockReceipt(
    offsetLocalDateKey(today, -1)
  );

  const replay = await page.request.post("/api/time-blocks", {
    data: seeded.payload,
    headers: { "X-Dayflow-Mutation-Id": seeded.mutationId }
  });
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(seeded.response);

  const conflict = await page.request.post("/api/time-blocks", {
    data: { ...seeded.payload, title: "A different request" },
    headers: { "X-Dayflow-Mutation-Id": seeded.mutationId }
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).code).toBe("MUTATION_ID_CONFLICT");
});

test("keeps the original payload and mutation ID when a UI retry crosses midnight", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const tomorrow = offsetLocalDateKey(today, 1);
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Task retained across midnight",
      date: today,
      estimateMinutes: 30
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };
  await page.clock.install({
    time: new Date(`${today}T23:00:00`)
  });
  await openDashboard(page);
  await openTimeline(page);

  await page
    .getByRole("button", {
      name: "Block time for Task retained across midnight",
      exact: true
    })
    .click();
  const dialog = addDialog(page);
  await fillBlock(dialog, {
    title: "Retry the same logical block",
    start: "22:00",
    end: "22:30"
  });
  const attempts: Array<{
    date: string;
    mutationId: string | undefined;
    taskId: string | null;
  }> = [];
  await page.route("**/api/time-blocks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      date: string;
      taskId: string | null;
    };
    attempts.push({
      date: payload.date,
      taskId: payload.taskId,
      mutationId:
        route.request().headers()["x-dayflow-mutation-id"]
    });
    if (attempts.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({
        status: 503,
        json: { error: "Response lost after commit." }
      });
      return;
    }
    await route.continue();
  });

  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "Response lost after commit."
  );

  let midnightRefreshes = 0;
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    midnightRefreshes += 1;
    await route.fulfill({
      response,
      json: {
        ...payload,
        todayKey: tomorrow,
        tasks: [],
        paletteTasks: [],
        timeBlocks: []
      }
    });
  });
  await page.clock.pauseAt(new Date(`${today}T23:59:58`));
  await page.clock.fastForward(3_000);
  await expect.poll(() => midnightRefreshes).toBeGreaterThan(0);
  await expect(
    dialog.getByLabel("Linked task", { exact: true })
  ).toHaveValue(task.id);
  await expect(
    dialog.getByRole("option", {
      name: "Task retained across midnight · 30m",
      exact: true
    })
  ).toHaveCount(1);

  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].date).toBe(today);
  expect(attempts[1].date).toBe(today);
  expect(attempts[0].taskId).toBe(task.id);
  expect(attempts[1].taskId).toBe(task.id);
  expect(attempts[0].mutationId).toBeTruthy();
  expect(attempts[1].mutationId).toBe(attempts[0].mutationId);
});

test("keeps the phone Timeline and Time Block dialog inside the viewport", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).todayKey);
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Phone touch target",
      date: today,
      estimateMinutes: 15
    }
  });
  expect(created.status()).toBe(201);

  await openDashboard(page);
  await openTimeline(page);
  await expectUsableTouchTarget(
    page.getByRole("button", { name: "Add time block", exact: true })
  );
  await expectUsableTouchTarget(
    page.getByRole("button", {
      name: "Block time for Phone touch target",
      exact: true
    })
  );

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    )
    .toBe(true);

  const dialog = await openAddDialog(page);
  await expectUsableTouchTarget(
    dialog.getByRole("button", { name: "Close add time block", exact: true })
  );
  await expectUsableTouchTarget(
    dialog.getByRole("button", { name: "Add block", exact: true })
  );
  await fillBlock(dialog, {
    title: "Phone-sized plan",
    start: "16:00",
    end: "16:15"
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    )
    .toBe(true);

  await dialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expectUsableTouchTarget(
    timeBlock(page, "Phone-sized plan", "16:00", "16:15")
  );

  const adjacentDialog = await openAddDialog(page);
  await fillBlock(adjacentDialog, {
    title: "Adjacent phone plan",
    start: "16:15",
    end: "16:30"
  });
  await adjacentDialog
    .getByRole("button", { name: "Add block", exact: true })
    .click();
  await expect(adjacentDialog).toHaveCount(0);

  const firstBlock = timeBlock(page, "Phone-sized plan", "16:00", "16:15");
  const secondBlock = timeBlock(
    page,
    "Adjacent phone plan",
    "16:15",
    "16:30"
  );
  await firstBlock.scrollIntoViewIfNeeded();
  const firstBox = await firstBlock.boundingBox();
  const secondBox = await secondBlock.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(firstBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(secondBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((firstBox?.y ?? 0) + (firstBox?.height ?? 0)).toBeLessThanOrEqual(
    (secondBox?.y ?? 0) + 1
  );
});

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function offsetLocalDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

async function expectUsableTouchTarget(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}
