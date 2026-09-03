import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_FOCUS_MINUTES } from "../../src/lib/focus-domain";
import {
  resetTestDatabase,
  seedJournalHistory,
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
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible();
}

/**
 * The running Focus rail labels this "Finish"; the paused rail labels it
 * "Finish 3m". A fixture created near local midnight is paused so its elapsed
 * time stays independent of the wall clock, so accept either label.
 */
const FINISH_BUTTON = /^Finish( \d+m)?$/;

function taskRow(page: Page, title: string) {
  return page.getByRole("article", { name: `Task: ${title}`, exact: true });
}

async function openDataAndBackups(page: Page) {
  const opener = page.getByRole("button", {
    name: "Data & backups",
    exact: true
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Data & backups",
    exact: true
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Create backup", exact: true })
  ).toBeEnabled();
  return { dialog, opener };
}

async function createBackupFromDialog(page: Page) {
  const { dialog } = await openDataAndBackups(page);
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/backups" &&
      response.request().method() === "POST"
  );
  await dialog
    .getByRole("button", { name: "Create backup", exact: true })
    .click();
  expect((await createResponse).status()).toBe(201);
  await expect(
    dialog.getByRole("status").getByText("Backup created and verified.", {
      exact: true
    })
  ).toBeVisible();
  return dialog;
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
  await expect(
    palette.getByText(`Start a ${DEFAULT_FOCUS_MINUTES}m Focus Session`, {
      exact: true
    })
  ).toBeVisible();
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

test("creates, lists, and exposes a verified local backup accessibly", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Keep this in the recovery copy");

  const { dialog, opener } = await openDataAndBackups(page);
  const close = dialog.getByRole("button", {
    name: "Close data and backups",
    exact: true
  });
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  const reopened = (await openDataAndBackups(page)).dialog;
  await expect(
    reopened.getByText("No backups yet", { exact: true })
  ).toBeVisible();
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/backups" &&
      response.request().method() === "POST"
  );
  await reopened
    .getByRole("button", { name: "Create backup", exact: true })
    .click();
  expect((await createResponse).status()).toBe(201);

  await expect(
    reopened.getByRole("status").getByText("Backup created and verified.", {
      exact: true
    })
  ).toBeVisible();
  const backups = reopened.getByRole("region", {
    name: "Available backups",
    exact: true
  });
  await expect(backups.locator(".backup-list-item")).toHaveCount(1);

  const details = reopened.getByRole("region", {
    name: "Backup details",
    exact: true
  });
  await expect(details.getByText("Verified", { exact: true })).toBeVisible();
  await expect(details.getByText("Records", { exact: true })).toBeVisible();
  await expect(
    details.getByText("Keep this in the recovery copy", { exact: true })
  ).toHaveCount(0);
  await expect(
    details.locator(".backup-technical-details code").first()
  ).toHaveText(/^[a-f0-9]{64}$/);
  const downloadLink = details.getByRole("link", {
    name: "Download",
    exact: true
  });
  await expect(downloadLink).toHaveAttribute(
    "href",
    /^\/api\/backups\/[^/]+\/download$/
  );
  const downloadPath = await downloadLink.getAttribute("href");
  expect(downloadPath).toBeTruthy();
  const download = await page.request.get(downloadPath!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toMatch(
    /^attachment; filename=".+\.dayflow-backup"$/
  );
  expect((await download.body()).subarray(0, 15).toString("utf8")).toBe(
    "DAYFLOW-BACKUP\n"
  );

  await page.reload();
  await expect(taskRow(page, "Keep this in the recovery copy")).toBeVisible();
  const afterReload = (await openDataAndBackups(page)).dialog;
  await expect(
    afterReload
      .getByRole("region", { name: "Available backups", exact: true })
      .locator(".backup-list-item")
  ).toHaveCount(1);
});

test("gates and stages restore without replacing the running browser-test database", async ({
  page
}) => {
  await openDashboard(page);
  const dialog = await createBackupFromDialog(page);
  const indexResponse = await page.request.get("/api/backups");
  expect(indexResponse.status()).toBe(200);
  const backupIndex = (await indexResponse.json()) as Record<string, unknown> & {
    backups: Array<Record<string, unknown>>;
  };
  expect(backupIndex.backups).toHaveLength(1);

  const restoreCapture: { request: Record<string, unknown> | null } = {
    request: null
  };
  let pendingRestore: Record<string, unknown> | null = null;
  let cancelRequests = 0;
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      json: { ...backupIndex, pendingRestore }
    });
  });
  await page.route("**/api/backups/restore", async (route) => {
    if (route.request().method() === "DELETE") {
      cancelRequests += 1;
      pendingRestore = null;
      await route.fulfill({
        status: 200,
        json: { ...backupIndex, pendingRestore: null }
      });
      return;
    }
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    restoreCapture.request = route.request().postDataJSON() as Record<
      string,
      unknown
    >;
    pendingRestore = {
      version: 1,
      status: "pending_restart",
      backupId: restoreCapture.request.backupId,
      fileName: backupIndex.backups[0]?.fileName,
      expectedPayloadSha256:
        restoreCapture.request.expectedPayloadSha256,
      scheduledAt: new Date().toISOString()
    };
    await route.fulfill({
      status: 202,
      json: { ...backupIndex, pendingRestore }
    });
  });

  await dialog
    .getByRole("button", { name: "Restore this backup…", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Restore this backup on next startup?",
    exact: true
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true })
  ).toBeFocused();
  await expect(confirmation).toContainText(
    "Dayflow will keep using the current data until its next startup."
  );
  await expect(confirmation).toContainText(
    "a separate safety backup of the current database"
  );

  const confirmInput = confirmation.getByLabel(
    "Type RESTORE to schedule replacement",
    { exact: true }
  );
  const restore = confirmation.getByRole("button", {
    name: "Restore on next startup",
    exact: true
  });
  await expect(restore).toBeDisabled();
  await confirmInput.fill("restore");
  await expect(restore).toBeDisabled();
  await confirmInput.fill("RESTORE");
  await expect(restore).toBeEnabled();
  await restore.click();

  await expect.poll(() => restoreCapture.request).not.toBeNull();
  const restoreRequest = restoreCapture.request;
  if (!restoreRequest) {
    throw new Error("The staged restore request was not intercepted.");
  }
  expect(restoreRequest.confirmation).toBe("RESTORE");
  expect(restoreRequest.backupId).toEqual(expect.any(String));
  expect(String(restoreRequest.backupId)).not.toHaveLength(0);
  expect(restoreRequest.expectedPayloadSha256).toEqual(
    expect.stringMatching(/^[a-f0-9]{64}$/)
  );

  await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText(
    "Restore scheduled. It will replace the data on the next Dayflow startup after creating a safety backup."
  );
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Restore scheduled for the next Dayflow startup."
  );
  const pending = dialog.getByRole("region", {
    name: "Pending restore",
    exact: true
  });
  await expect(pending).toBeVisible();
  await pending
    .getByRole("button", { name: "Cancel pending restore", exact: true })
    .click();
  await expect.poll(() => cancelRequests).toBe(1);
  await expect(pending).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText(
    "Pending restore canceled. The current data will stay active."
  );
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Pending restore canceled."
  );
});

test("keeps restore confirmation open when scheduling fails", async ({
  page
}) => {
  await openDashboard(page);
  const dialog = await createBackupFromDialog(page);
  await page.route("**/api/backups/restore", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      json: {
        error:
          "The selected backup changed after it was inspected. Refresh and try again.",
        code: "CONFLICT",
        field: "expectedPayloadSha256"
      }
    });
  });

  const restoreTrigger = dialog.getByRole("button", {
    name: "Restore this backup…",
    exact: true
  });
  await restoreTrigger.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Restore this backup on next startup?",
    exact: true
  });
  const confirmInput = confirmation.getByLabel(
    "Type RESTORE to schedule replacement",
    { exact: true }
  );
  await confirmInput.fill("RESTORE");
  await confirmation
    .getByRole("button", {
      name: "Restore on next startup",
      exact: true
    })
    .click();

  await expect(confirmation).toBeVisible();
  await expect(confirmInput).toHaveValue("RESTORE");
  await expect(confirmation.getByRole("alert")).toHaveText(
    /selected backup changed after it was inspected/i
  );
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(restoreTrigger).toBeFocused();
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
  await expect(page.locator(".sr-only[role='status']")).toHaveText("");

  await editedRow
    .getByRole("button", { name: "Show task details: Edited first task" })
    .click();
  const deadline = editedRow.getByLabel("Deadline", { exact: true });
  await deadline.fill("2026-07-30");
  await expect(
    deadline
      .locator("xpath=ancestor::label")
      .getByText("Saved", { exact: true })
  ).toBeVisible();
  const estimate = editedRow.getByLabel("Estimate in minutes");
  await estimate.fill("45");
  await expect(
    estimate
      .locator("xpath=ancestor::label")
      .getByText("Saved", { exact: true })
  ).toBeVisible();
  await editedRow.getByLabel("Task status").selectOption("IN_PROGRESS");
  await expect(
    editedRow
      .getByLabel("Task status")
      .locator("xpath=ancestor::label")
      .getByText("Saved", { exact: true })
  ).toBeVisible();

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
    page.getByText('Moved "Edited first task" to position 2 of 2. Now last.', {
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

test("keeps retries silent until failure and speaks only the recovery", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Retry this title");

  let failedAttempts = 0;
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    failedAttempts += 1;
    await route.fulfill({ status: 500, json: { error: "Test failure" } });
  });

  const row = taskRow(page, "Retry this title");
  await row.getByLabel("Task title: Retry this title").fill("Preserve this title");
  await expect.poll(() => failedAttempts).toBeGreaterThanOrEqual(1);
  await expect(page.locator(".sr-only[role='status']")).toHaveText("");

  const failedRow = taskRow(page, "Preserve this title");
  await expect(failedRow.locator(".save-state-chip.error")).toContainText("Not saved", {
    timeout: 8_000
  });
  expect(failedAttempts).toBe(3);
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Changes were not saved."
  );

  await page.unroute("**/api/tasks/*");
  await failedRow.getByRole("button", { name: "Retry" }).click();
  await expect(failedRow.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".sr-only[role='status']")).toHaveText("Saved.");
  await expect(failedRow.getByLabel("Task title: Preserve this title")).toHaveValue(
    "Preserve this title"
  );
});

test("preserves a new Task draft through a failed create and retries once", async ({
  page
}) => {
  await openDashboard(page);
  const draft = page.getByPlaceholder("Add a task for today");
  await draft.fill("Keep this new task");

  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, json: { error: "Task create failed." } });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(draft).toHaveValue("Keep this new task");
  await expect(page.getByText("Task create failed.", { exact: true })).toBeVisible();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Task was not saved."
  );

  await page.unroute("**/api/tasks");
  const createTask = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createTask).ok()).toBe(true);
  await expect(draft).toHaveValue("");
  await expect(taskRow(page, "Keep this new task")).toHaveCount(1);
});

test("treats malformed Task success JSON as a failed create", async ({ page }) => {
  await openDashboard(page);
  const draft = page.getByPlaceholder("Add a task for today");
  await draft.fill("Do not clear this draft");

  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(draft).toHaveValue("Do not clear this draft");
  await expect(
    page.getByText("Your task was not saved. Your draft is still here.", {
      exact: true
    })
  ).toBeVisible();
  await expect(taskRow(page, "Do not clear this draft")).toHaveCount(0);
});

test("treats malformed Task and Diary update success JSON as save failures", async ({
  page
}) => {
  test.slow();
  await openDashboard(page);
  await addTask(page, "Keep canonical edits");

  let taskAttempts = 0;
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    taskAttempts += 1;
    await route.fulfill({ status: 200, json: { ok: true } });
  });

  const taskTitle = taskRow(page, "Keep canonical edits").getByLabel(
    "Task title: Keep canonical edits"
  );
  await taskTitle.fill("Keep this Task draft");
  await taskTitle.press("Meta+Enter");
  const failedTaskRow = taskRow(page, "Keep this Task draft");
  await expect(failedTaskRow.locator(".save-state-chip.error")).toContainText(
    "Not saved",
    { timeout: 8_000 }
  );
  expect(taskAttempts).toBe(3);
  await expect(
    failedTaskRow.getByLabel("Task title: Keep this Task draft")
  ).toHaveValue("Keep this Task draft");
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Changes were not saved."
  );
  await page.unroute("**/api/tasks/*");

  await page.getByRole("button", { name: "Journal", exact: true }).click();
  let diaryAttempts = 0;
  await page.route("**/api/diary", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    diaryAttempts += 1;
    await route.fulfill({ status: 200, json: { ok: true } });
  });

  const diaryDraft = page.getByPlaceholder("Write a few lines about the day.");
  await diaryDraft.fill("Keep this Journal draft");
  await diaryDraft.press("Meta+Enter");
  await expect(
    page.locator(".journal-card-heading .save-state-chip.error")
  ).toContainText("Not saved", { timeout: 8_000 });
  expect(diaryAttempts).toBe(3);
  await expect(diaryDraft).toHaveValue("Keep this Journal draft");
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Journal was not saved."
  );
});

test("treats malformed focus queue and Phase success JSON as failures", async ({
  page
}) => {
  test.slow();
  await openDashboard(page);
  await addTask(page, "Current malformed focus");
  await addTask(page, "Keep out of a malformed queue");

  await taskRow(page, "Current malformed focus")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start 30m focus", exact: true })
    .click();

  await page.route("**/api/focus-queue", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await taskRow(page, "Keep out of a malformed queue")
    .getByRole("button", { name: /^Queue(?: next)?$/ })
    .click();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "The focus queue was not saved."
  );
  await expect(
    page.getByText("Couldn’t save the focus queue. Try that action again.", {
      exact: true
    })
  ).toBeVisible();
  await page.unroute("**/api/focus-queue");

  const queued = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "POST"
  );
  await taskRow(page, "Keep out of a malformed queue")
    .getByRole("button", { name: /^Queue(?: next)?$/ })
    .click();
  expect((await queued).ok()).toBe(true);

  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  await page.route("**/api/focus-queue", async (route) => {
    if (!["PATCH", "DELETE"].includes(route.request().method())) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await rail
    .getByRole("button", {
      name: "Move Keep out of a malformed queue up",
      exact: true
    })
    .click();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "The new queue order was not saved."
  );
  await expect(
    page.getByText("Couldn’t save the new queue order. Retry the move.", {
      exact: true
    })
  ).toBeVisible();

  await rail
    .getByRole("button", {
      name: "Remove Keep out of a malformed queue from queue",
      exact: true
    })
    .click();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "The focus queue was not saved."
  );
  await expect(
    page.getByText("Couldn’t remove that task from the focus queue.", {
      exact: true
    })
  ).toBeVisible();
  await page.unroute("**/api/focus-queue");

  await page.getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel(/Name required/).fill("Canonical Project responses");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Add a phase", exact: true }).click();
  await page.getByPlaceholder("Add an optional phase").fill("Canonical Phase");
  await page.getByRole("button", { name: "Add phase" }).click();

  await page.route("**/api/phases/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  const phaseName = page.getByLabel("Phase name: Canonical Phase");
  await phaseName.fill("Keep this Phase draft");
  await phaseName.press("Meta+Enter");
  const failedPhase = page
    .locator(".phase-header")
    .filter({ has: phaseName });
  await expect(failedPhase.locator(".save-state-chip.error")).toContainText(
    "Not saved",
    { timeout: 8_000 }
  );
  await expect(phaseName).toHaveValue("Keep this Phase draft");
  await expect(
    page.getByText(
      "Couldn’t save the phase name. Your text is still here — retry.",
      { exact: true }
    )
  ).toBeVisible();
});

test("keeps Activity and Project drafts after malformed success JSON", async ({
  page
}) => {
  await openDashboard(page);

  await page.getByRole("button", { name: /Search or add/ }).click();
  await page.getByRole("option", { name: /Log an activity by hand/ }).click();
  const activityDialog = page.getByRole("dialog", { name: "Log activity" });
  const activityDraft = activityDialog.getByPlaceholder(
    "Record a small win or what moved forward."
  );
  await activityDraft.fill("Keep this activity draft");
  await page.route("**/api/activities", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { id: "not-canonical" } });
      return;
    }
    await route.continue();
  });
  await activityDialog.getByRole("button", { name: "Add activity" }).click();
  await expect(activityDialog).toBeVisible();
  await expect(activityDraft).toHaveValue("Keep this activity draft");
  await expect(
    activityDialog.getByText(
      "Activity could not be saved. Your draft is still here.",
      { exact: true }
    )
  ).toBeVisible();
  await page.unroute("**/api/activities");
  await activityDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const projectDialog = page.getByRole("dialog", { name: "Create project" });
  const projectDraft = projectDialog.getByLabel(/Name required/);
  await projectDraft.fill("Keep this Project draft");
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { id: "not-canonical" } });
      return;
    }
    await route.continue();
  });
  await projectDialog.getByRole("button", { name: "Create project" }).click();
  await expect(projectDialog).toBeVisible();
  await expect(projectDraft).toHaveValue("Keep this Project draft");
  await expect(
    projectDialog.getByText(
      "Project could not be created. Your draft is still here.",
      { exact: true }
    )
  ).toBeVisible();
});

test("replays an idempotent Task create without duplicating the record", async ({
  page
}) => {
  await openDashboard(page);
  const headers = { "X-Dayflow-Mutation-Id": "e2e-task-create-1" };
  const bootstrap = await page.request.get("/api/bootstrap");
  const today = String((await bootstrap.json()).today).slice(0, 10);
  const data = {
    title: "Create exactly once",
    date: today,
    estimateMinutes: 30
  };

  const first = await page.request.post("/api/tasks", { data, headers });
  const replay = await page.request.post("/api/tasks", { data, headers });
  expect(first.status()).toBe(201);
  expect(replay.status()).toBe(201);
  expect((await replay.json()).id).toBe((await first.json()).id);

  const conflict = await page.request.post("/api/tasks", {
    data: { ...data, title: "A different logical request" },
    headers
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).code).toBe("MUTATION_ID_CONFLICT");

  await page.reload();
  await expect(taskRow(page, "Create exactly once")).toHaveCount(1);
  await expect(taskRow(page, "A different logical request")).toHaveCount(0);
});

test("replays idempotent Project and Phase creates without duplicates", async ({
  page
}) => {
  const projectHeaders = {
    "X-Dayflow-Mutation-Id": "e2e-project-create-1"
  };
  const projectData = {
    name: "Reliable planning",
    desiredOutcome: "One durable Project"
  };
  const projectFirst = await page.request.post("/api/projects", {
    data: projectData,
    headers: projectHeaders
  });
  const projectReplay = await page.request.post("/api/projects", {
    data: projectData,
    headers: projectHeaders
  });
  expect(projectFirst.status()).toBe(201);
  expect(projectReplay.status()).toBe(201);
  const project = (await projectFirst.json()) as { id: string };
  expect((await projectReplay.json()).id).toBe(project.id);

  const phaseHeaders = {
    "X-Dayflow-Mutation-Id": "e2e-phase-create-1"
  };
  const phaseFirst = await page.request.post(
    `/api/projects/${project.id}/phases`,
    { data: { name: "Only once" }, headers: phaseHeaders }
  );
  const phaseReplay = await page.request.post(
    `/api/projects/${project.id}/phases`,
    { data: { name: "Only once" }, headers: phaseHeaders }
  );
  expect(phaseFirst.status()).toBe(201);
  expect(phaseReplay.status()).toBe(201);
  expect((await phaseReplay.json()).id).toBe((await phaseFirst.json()).id);

  const detail = (await (
    await page.request.get(`/api/projects/${project.id}`)
  ).json()) as { phases: Array<{ name: string }> };
  expect(detail.phases.filter((phase) => phase.name === "Only once")).toHaveLength(
    1
  );
  const projects = (await (
    await page.request.get("/api/projects")
  ).json()) as Array<{ name: string }>;
  expect(
    projects.filter((candidate) => candidate.name === "Reliable planning")
  ).toHaveLength(1);
});

test("replays a committed Focus start after malformed success JSON", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Replay malformed Focus start");
  await taskRow(page, "Replay malformed Focus start")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();

  const mutationIds: string[] = [];
  let replacedCommittedResponse = false;
  await page.route("**/api/focus-session", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    mutationIds.push(
      route.request().headers()["x-dayflow-mutation-id"] ?? ""
    );
    if (!replacedCommittedResponse) {
      replacedCommittedResponse = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({ status: 201, json: { snapshot: {} } });
      return;
    }
    await route.continue();
  });

  const start = page.getByRole("button", {
    name: "Start 30m focus",
    exact: true
  });
  await start.click();
  await expect(
    page.getByText("The timer could not be started.", { exact: true })
  ).toBeVisible();
  await expect(start).toBeVisible();

  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await start.click();
  expect((await replay).status()).toBe(201);
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[0]).not.toBe("");
  expect(mutationIds[1]).toBe(mutationIds[0]);
  await expect(
    page
      .getByRole("complementary", { name: "Focus rail" })
      .getByRole("button", { name: "Pause", exact: true })
  ).toBeVisible();

  const exported = await page.request.get("/api/agent-export");
  expect(exported.ok()).toBe(true);
  expect(
    ((await exported.json()) as { focusSessions: unknown[] }).focusSessions
  ).toHaveLength(1);
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
  const pause = fullRail.getByRole("button", { name: "Pause", exact: true });
  await expect(pause).toHaveClass(/focus-button/);
  expect(
    await pause.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(231, 237, 222)");
  const logByHand = fullRail.getByRole("button", {
    name: "Log something by hand",
    exact: true
  });
  expect(
    await logByHand.evaluate((element) => getComputedStyle(element).color)
  ).toBe("rgb(168, 120, 92)");

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
  expect(
    await reloadedRail
      .locator(".paused-focus-card .secondary-button")
      .evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(255, 254, 251)");

  setFocusSessionElapsedMinutes(session.id, 2);
  await reloadedRail.getByRole("button", { name: "Resume", exact: true }).click();
  await reloadedRail.getByRole("button", { name: FINISH_BUTTON }).click();

  await expect(reloadedRail.getByRole("heading", { name: "2m counted" })).toBeVisible();
  await reloadedRail
    .getByPlaceholder("Add a note if it will help you remember this session.")
    .fill("Verified the persistent completion record");
  await reloadedRail.getByRole("button", { name: "Still going" }).click();
  await reloadedRail.getByRole("button", { name: "Continue to a 2m break" }).click();
  await expect(reloadedRail.getByText("Nothing is being recorded.")).toBeVisible();
  await expect(reloadedRail.getByRole("heading", { name: "Break" })).toBeVisible();
  expect(
    await reloadedRail
      .locator(".break-focus-card .secondary-button")
      .evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(255, 254, 251)");
  await expect(
    reloadedRail.locator(".rail-focus-clock span").getByText("2m", { exact: true })
  ).toBeVisible();
});

test("persists the explicit focus queue across reload and keeps its own order", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Current focus");
  await addTask(page, "Review saved learning materials");
  await addTask(page, "Prepare tomorrow");

  await taskRow(page, "Current focus")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();
  const startFocus = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Start 30m focus", exact: true }).click();
  const startResponse = await startFocus;
  expect(startResponse.ok()).toBe(true);
  const { session } = (await startResponse.json()) as {
    session: { id: string };
  };

  const reviewRow = taskRow(page, "Review saved learning materials");
  const prepareRow = taskRow(page, "Prepare tomorrow");
  const reviewQueue = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "POST"
  );
  await reviewRow
    .getByRole("button", { name: "Queue next", exact: true })
    .click();
  expect((await reviewQueue).ok()).toBe(true);
  const prepareQueue = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "POST"
  );
  await prepareRow.getByRole("button", { name: "Queue", exact: true }).click();
  expect((await prepareQueue).ok()).toBe(true);

  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(rail.getByText("65m", { exact: true })).toBeVisible();
  await expect(
    rail.getByText(
      "Finishing this session starts Break — stand up unless you change it.",
      { exact: true }
    )
  ).toBeVisible();
  await expect
    .poll(() =>
      rail.locator(".focus-queue-entry strong").allTextContents()
    )
    .toEqual([
      "Break",
      "Review saved learning materials",
      "Prepare tomorrow"
    ]);

  const queueButtonColor = await prepareRow
    .getByRole("button", { name: "Queued", exact: true })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(queueButtonColor).not.toBe("rgb(231, 237, 222)");

  await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  await expect(
    rail.getByRole("button", {
      name: "Move Break — stand up up",
      exact: true
    })
  ).toBeDisabled();
  await expect(
    rail.getByRole("button", {
      name: "Move Break — stand up down",
      exact: true
    })
  ).toBeEnabled();
  await expect(
    rail.getByRole("button", {
      name: "Remove Break — stand up from queue",
      exact: true
    })
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStrip = page.getByRole("complementary", {
    name: "Active focus session"
  });
  await expect(mobileStrip).toBeVisible();
  await mobileStrip.locator(".focus-strip-ring").click();
  const mobileRail = page.getByRole("complementary", { name: "Focus rail" });
  await mobileRail.getByRole("button", { name: "Reorder", exact: true }).click();
  for (const target of [
    mobileRail.getByRole("button", { name: "Done", exact: true }),
    mobileRail.getByRole("button", {
      name: "Move Break — stand up down",
      exact: true
    }),
    mobileRail.getByRole("button", {
      name: "Remove Break — stand up from queue",
      exact: true
    }),
    mobileRail.getByLabel("Add to queue"),
    mobileRail.getByRole("button", { name: "Add", exact: true })
  ]) {
    const box = await target.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  if (
    await rail
      .getByRole("button", { name: "Reorder", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  }
  const reorderQueue = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "PATCH"
  );
  await rail
    .getByRole("button", { name: "Move Prepare tomorrow up", exact: true })
    .click();
  expect((await reorderQueue).ok()).toBe(true);
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Prepare tomorrow, now 2 of 3."
  );

  await page.reload();
  const reloadedRail = page.getByRole("complementary", { name: "Focus rail" });
  await expect
    .poll(() =>
      reloadedRail.locator(".focus-queue-entry strong").allTextContents()
    )
    .toEqual([
      "Break",
      "Prepare tomorrow",
      "Review saved learning materials"
    ]);

  const bootstrap = (await (await page.request.get("/api/bootstrap")).json()) as {
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      focusQueuePosition: number | null;
    }>;
  };
  const openIds = bootstrap.tasks
    .filter((task) => task.status !== "DONE")
    .map((task) => task.id)
    .reverse();
  expect(
    (
      await page.request.post("/api/tasks/reorder", {
        data: { ids: openIds }
      })
    ).ok()
  ).toBe(true);
  await page.reload();
  await expect
    .poll(() =>
      page
        .getByRole("complementary", { name: "Focus rail" })
        .locator(".focus-queue-entry strong")
        .allTextContents()
    )
    .toEqual([
      "Break",
      "Prepare tomorrow",
      "Review saved learning materials"
    ]);

  const activeRail = page.getByRole("complementary", { name: "Focus rail" });
  await activeRail.getByRole("button", { name: "Reorder", exact: true }).click();
  await expect(
    activeRail.getByRole("button", {
      name: "Remove Prepare tomorrow from queue",
      exact: true
    })
  ).toBeVisible();
  await activeRail.getByRole("button", { name: "Done", exact: true }).click();
  const removeQueue = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "DELETE"
  );
  await activeRail
    .getByRole("button", {
      name: "Remove Prepare tomorrow from queue",
      exact: true
    })
    .click();
  expect((await removeQueue).ok()).toBe(true);
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Prepare tomorrow, removed from the queue."
  );
  await activeRail
    .getByRole("button", {
      name: "Remove Break — stand up from queue",
      exact: true
    })
    .click();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Break — stand up, removed from the queue."
  );

  const completeQueuedTask = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tasks/") &&
      response.request().method() === "PATCH"
  );
  await taskRow(page, "Review saved learning materials")
    .getByRole("button", {
      name: "Complete Review saved learning materials",
      exact: true
    })
    .click();
  expect((await completeQueuedTask).ok()).toBe(true);
  await expect(
    activeRail.getByText(
      "Nothing queued. Finishing this session returns you to Today.",
      { exact: true }
    )
  ).toBeVisible();
  const completedBootstrap = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as {
    tasks: Array<{
      id: string;
      title: string;
      focusQueuePosition: number | null;
    }>;
  };
  const completedReview = completedBootstrap.tasks.find(
    (task) => task.title === "Review saved learning materials"
  );
  expect(completedReview?.focusQueuePosition).toBeNull();
  expect(
    (
      await page.request.patch(`/api/tasks/${completedReview?.id}`, {
        data: { status: "TODO" }
      })
    ).ok()
  ).toBe(true);
  await page.reload();
  await expect(
    taskRow(page, "Review saved learning materials").getByRole("button", {
      name: "Queued",
      exact: true
    })
  ).toHaveCount(0);

  const prepareQueueAgain = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-queue") &&
      response.request().method() === "POST"
  );
  await taskRow(page, "Prepare tomorrow")
    .getByRole("button", { name: /Queue/ })
    .click();
  expect((await prepareQueueAgain).ok()).toBe(true);

  expect(
    (
      await page.request.patch(`/api/focus-session/${session.id}`, {
        data: { action: "cancel" }
      })
    ).ok()
  ).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Focus task").locator("option:checked")).toHaveText(
    "Prepare tomorrow"
  );
  await taskRow(page, "Prepare tomorrow")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();
  await page.getByRole("button", { name: "Start 30m focus", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Focus rail" })
      .getByText(
        "Finishing this session starts Break — stand up unless you change it.",
        { exact: true }
      )
  ).toBeVisible();
});

test("rejects invalid and stale focus queue writes", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "First queued task");
  await addTask(page, "Second queued task");

  const bootstrap = (await (await page.request.get("/api/bootstrap")).json()) as {
    tasks: Array<{ id: string; title: string }>;
  };
  const first = bootstrap.tasks.find((task) => task.title === "First queued task");
  const second = bootstrap.tasks.find((task) => task.title === "Second queued task");
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();

  const invalid = await page.request.post("/api/focus-queue", {
    data: { taskId: first?.id, placement: "sideways" }
  });
  expect(invalid.status()).toBe(400);

  expect(
    (
      await page.request.post("/api/focus-queue", {
        data: { taskId: first?.id, placement: "end" }
      })
    ).ok()
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/focus-queue", {
        data: { taskId: second?.id, placement: "end" }
      })
    ).ok()
  ).toBe(true);

  const original = [first!.id, second!.id];
  expect(
    (
      await page.request.patch("/api/focus-queue", {
        data: { expectedIds: original, ids: [...original].reverse() }
      })
    ).ok()
  ).toBe(true);
  const stale = await page.request.patch("/api/focus-queue", {
    data: { expectedIds: original, ids: original }
  });
  expect(stale.status()).toBe(409);
});

test("rejects invalid evidence dates, times, durations, and Focus kinds", async ({
  page
}) => {
  const invalidKind = await page.request.post("/api/focus-session", {
    data: {
      kind: "SPRINT",
      plannedMinutes: 25,
      label: "Invalid kind"
    }
  });
  expect(invalidKind.status()).toBe(400);

  const invalidDuration = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 2.5,
      label: "Fractional duration"
    }
  });
  expect(invalidDuration.status()).toBe(400);

  for (const data of [
    {
      date: "not-a-date",
      durationMinutes: 20,
      note: "Invalid date",
      category: "Deep Work"
    },
    {
      date: "2026-02-30",
      durationMinutes: 20,
      note: "Impossible date",
      category: "Deep Work"
    },
    {
      date: "2026-02-30T10:00:00Z",
      durationMinutes: 20,
      note: "Impossible ISO date",
      category: "Deep Work"
    },
    {
      date: "02/30/2026",
      durationMinutes: 20,
      note: "Unsupported ambiguous date",
      category: "Deep Work"
    },
    {
      startTime: "29:72",
      durationMinutes: 20,
      note: "Invalid time",
      category: "Deep Work"
    },
    {
      durationMinutes: 2.5,
      note: "Invalid fractional duration",
      category: "Deep Work"
    }
  ]) {
    const response = await page.request.post("/api/activities", { data });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.any(String)
    }));
  }

  const invalidNoteDate = await page.request.post("/api/notes", {
    data: {
      content: "Invalid note date",
      date: "not-a-date"
    }
  });
  expect(invalidNoteDate.status()).toBe(400);

  const invalidDiaryDate = await page.request.put("/api/diary", {
    data: {
      date: "not-a-date",
      content: "Invalid diary date",
      mood: 3,
      energy: 3
    }
  });
  expect(invalidDiaryDate.status()).toBe(400);

  const invalidDiaryRating = await page.request.put("/api/diary", {
    data: {
      date: "2026-07-27",
      content: "Invalid diary rating",
      mood: 6,
      energy: 3
    }
  });
  expect(invalidDiaryRating.status()).toBe(400);

  const missingMaterialNote = await page.request.post("/api/materials", {
    data: {
      title: "Missing linked note",
      url: "https://example.com/missing-note",
      noteId: "missing-note"
    }
  });
  expect(missingMaterialNote.status()).toBe(404);
});

test("offers queue actions during a taskless live focus session", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Queue from free focus");

  const response = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Free focus",
      taskId: null,
      projectId: null
    }
  });
  expect(response.ok()).toBe(true);
  await page.reload();

  await expect(
    taskRow(page, "Queue from free focus").getByRole("button", {
      name: "Queue next",
      exact: true
    })
  ).toBeVisible();
});

test("allows exactly one active Focus Session across concurrent starts", async ({
  page
}) => {
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      page.request.post("/api/focus-session", {
        data: {
          kind: "FOCUS",
          plannedMinutes: 25,
          label: `Concurrent focus ${index + 1}`
        }
      })
    )
  );
  const statuses = attempts.map((response) => response.status()).sort();
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  expect(statuses.filter((status) => status === 409)).toHaveLength(7);

  const snapshot = await page.request.get("/api/focus-session");
  expect(snapshot.ok()).toBe(true);
  const focus = (await snapshot.json()) as {
    active: { id: string } | null;
  };
  expect(focus.active).not.toBeNull();
});

test("allows only one terminal Focus transition when Complete and Cancel race", async ({
  page
}) => {
  const start = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Terminal transition race"
    }
  });
  expect(start.ok()).toBe(true);
  const { session } = (await start.json()) as { session: { id: string } };
  setFocusSessionElapsedMinutes(session.id, 3);

  const [complete, cancel] = await Promise.all([
    page.request.patch(`/api/focus-session/${session.id}`, {
      data: { action: "complete" }
    }),
    page.request.patch(`/api/focus-session/${session.id}`, {
      data: { action: "cancel" }
    })
  ]);
  expect([complete.status(), cancel.status()].sort()).toEqual([200, 409]);

  const bootstrap = await page.request.get("/api/bootstrap");
  const evidence = (await bootstrap.json()) as {
    activities: Array<{ focusSessionId: string | null }>;
  };
  const focusActivities = evidence.activities.filter(
    (activity) => activity.focusSessionId === session.id
  );
  expect(focusActivities).toHaveLength(complete.ok() ? 1 : 0);
});

test("returns one persisted result for simultaneous completion requests", async ({
  page
}) => {
  const start = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Concurrent completion"
    }
  });
  const { session } = (await start.json()) as { session: { id: string } };
  setFocusSessionElapsedMinutes(session.id, 3);

  const completions = await Promise.all([
    page.request.patch(`/api/focus-session/${session.id}`, {
      data: { action: "complete" }
    }),
    page.request.patch(`/api/focus-session/${session.id}`, {
      data: { action: "complete" }
    })
  ]);
  expect(completions.map((response) => response.status())).toEqual([200, 200]);
  const results = (await Promise.all(
    completions.map((response) => response.json())
  )) as Array<{
    completedSession: {
      id: string;
      actualMinutes: number;
      completedAt: string;
      activity: { id: string };
    };
  }>;
  expect(results[0].completedSession).toEqual(results[1].completedSession);
  expect(results[0].completedSession.activity.id).toEqual(expect.any(String));

  const evidence = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as {
    activities: Array<{ focusSessionId: string | null }>;
  };
  expect(
    evidence.activities.filter(
      (activity) => activity.focusSessionId === session.id
    )
  ).toHaveLength(1);
});

test("counts completed focus immediately while completion details remain optional", async ({
  page
}) => {
  await openDashboard(page);
  await addTask(page, "Count focus before details");

  await taskRow(page, "Count focus before details")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();
  await page.getByLabel("Custom focus minutes").fill("5");
  const startFocus = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/focus-session") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Start 5m focus" }).click();
  const { session } = (await (await startFocus).json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 3);

  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await rail.getByRole("button", { name: FINISH_BUTTON }).click();
  await expect(rail.getByRole("heading", { name: "3m counted" })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "Finish without details" })
  ).toBeEnabled();

  const firstBootstrap = await page.request.get("/api/bootstrap");
  expect(firstBootstrap.ok()).toBe(true);
  const firstEvidence = (await firstBootstrap.json()) as {
    activities: Array<{
      durationMinutes: number;
      focusSessionId: string | null;
      origin: string;
    }>;
  };
  expect(
    firstEvidence.activities.filter(
      (activity) => activity.focusSessionId === session.id
    )
  ).toEqual([
    expect.objectContaining({
      durationMinutes: 3,
      focusSessionId: session.id,
      origin: "FOCUS"
    })
  ]);

  const repeatedCompletion = await page.request.patch(
    `/api/focus-session/${session.id}`,
    { data: { action: "complete" } }
  );
  expect(repeatedCompletion.ok()).toBe(true);
  const repeatedBootstrap = await page.request.get("/api/bootstrap");
  const repeatedEvidence = (await repeatedBootstrap.json()) as {
    activities: Array<{ focusSessionId: string | null }>;
  };
  expect(
    repeatedEvidence.activities.filter(
      (activity) => activity.focusSessionId === session.id
    )
  ).toHaveLength(1);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  const focusedMetric = page
    .locator(".review-metrics > div")
    .filter({ hasText: "Focused" });
  await expect(
    focusedMetric.getByText("3m", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("3m is already counted.", { exact: true })).toBeVisible();

  const strip = page.getByRole("complementary", { name: "Completed focus session" });
  await expect(
    strip.getByRole("button", { name: "Add focus details", exact: true })
  ).toBeVisible();
  await strip.getByRole("button", { name: "Add focus details", exact: true }).click();
  const completionRail = page.getByRole("complementary", { name: "Focus rail" });
  await completionRail
    .getByRole("button", { name: "Finish without details" })
    .click();
  const captured = completionRail.locator(".captured-list");
  await expect(captured.getByText("Count focus before details", { exact: true })).toBeVisible();
  await expect(captured.getByText("3m · Deep Work", { exact: true })).toBeVisible();
});

test("protects generated Focus Activity evidence from deletion", async ({ page }) => {
  const start = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Protected evidence"
    }
  });
  const { session } = (await start.json()) as { session: { id: string } };
  setFocusSessionElapsedMinutes(session.id, 3);
  expect(
    (
      await page.request.patch(`/api/focus-session/${session.id}`, {
        data: { action: "complete" }
      })
    ).ok()
  ).toBe(true);

  const before = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as {
    activities: Array<{ id: string; focusSessionId: string | null }>;
  };
  const activity = before.activities.find(
    (entry) => entry.focusSessionId === session.id
  );
  expect(activity).toBeTruthy();

  const deletion = await page.request.delete(`/api/activities/${activity?.id}`);
  expect(deletion.status()).toBe(409);
  expect(await deletion.json()).toEqual({
    error: "Focus evidence cannot be deleted."
  });

  const after = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as {
    activities: Array<{ focusSessionId: string | null }>;
  };
  expect(
    after.activities.filter((entry) => entry.focusSessionId === session.id)
  ).toHaveLength(1);
});

test("keeps completed evidence committed when the next Focus start fails", async ({
  page
}) => {
  await openDashboard(page);
  const start = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Commit before next"
    }
  });
  expect(start.ok()).toBe(true);
  const { session } = (await start.json()) as { session: { id: string } };
  setFocusSessionElapsedMinutes(session.id, 3);
  await page.reload();

  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await rail.getByRole("button", { name: FINISH_BUTTON }).click();
  await expect(rail.getByRole("heading", { name: "3m counted" })).toBeVisible();

  let failedNextStart = false;
  await page.route("**/api/focus-session", async (route) => {
    if (route.request().method() === "POST" && !failedNextStart) {
      failedNextStart = true;
      await route.fulfill({
        status: 500,
        json: { error: "The next queue item could not be started." }
      });
      return;
    }
    await route.continue();
  });
  const record = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/focus-session/${session.id}`) &&
      response.request().method() === "PATCH"
  );
  await rail
    .getByRole("button", { name: "Continue to a 5m break" })
    .click();
  const recordResponse = await record;
  expect(recordResponse.ok()).toBe(true);
  const recordResult = (await recordResponse.json()) as {
    activity: {
      focusSessionId: string;
      durationMinutes: number;
    };
  };
  expect(recordResult.activity).toEqual(
    expect.objectContaining({
      focusSessionId: session.id,
      durationMinutes: 3
    })
  );

  await expect(rail.getByText("Start a focus session", { exact: true })).toBeVisible();
  await expect(
    rail.getByText("The next queue item could not be started.", { exact: true })
  ).toBeVisible();
  const snapshot = await page.request.get("/api/focus-session");
  const persisted = (await snapshot.json()) as {
    active: unknown;
    pendingCompletion: unknown;
  };
  expect(persisted.active).toBeNull();
  expect(persisted.pendingCompletion).toBeNull();

  const retry = rail.getByRole("button", { name: "Retry 5m break" });
  await expect(retry).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Retry 5m break" })
  ).toBeVisible();
  await page.reload();

  const reloadedRail = page.getByRole("complementary", {
    name: "Focus rail"
  });
  const reloadedRetry = reloadedRail.getByRole("button", {
    name: "Retry 5m break"
  });
  await expect(reloadedRetry).toBeVisible();
  await reloadedRetry.click();
  await expect(
    reloadedRail.getByRole("heading", { name: "Break", exact: true })
  ).toBeVisible();
});

test("adds manual and Focus Activities in actual time without double counting", async ({
  page
}) => {
  await openDashboard(page);

  const start = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Evidence calculation"
    }
  });
  expect(start.ok()).toBe(true);
  const { session } = (await start.json()) as { session: { id: string } };
  setFocusSessionElapsedMinutes(session.id, 3);
  const complete = await page.request.patch(`/api/focus-session/${session.id}`, {
    data: { action: "complete" }
  });
  expect(complete.ok()).toBe(true);

  const manual = await page.request.post("/api/activities", {
    data: {
      durationMinutes: 60,
      note: "Manual evidence",
      category: "Learning"
    }
  });
  expect(manual.ok()).toBe(true);

  const bootstrap = await page.request.get("/api/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  const evidence = (await bootstrap.json()) as {
    today: string;
    stats: Array<{ day: string; actualHours: number }>;
    reviewSummary: { focusedMinutes: number };
  };
  expect(
    evidence.stats.find((day) => day.day === evidence.today.slice(0, 10))
      ?.actualHours
  ).toBe(1.1);
  expect(evidence.reviewSummary.focusedMinutes).toBe(3);
});

test("loading Dayflow keeps missing Diary evidence unpersisted", async ({ page }) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  const evidence = (await bootstrap.json()) as {
    today: string;
    diary: { id: string | null; persisted: boolean };
    stats: Array<{
      day: string;
      mood: number | null;
      energy: number | null;
    }>;
  };
  const today = evidence.stats.find(
    (day) => day.day === evidence.today.slice(0, 10)
  );
  expect(evidence.diary).toEqual(
    expect.objectContaining({ id: null, persisted: false })
  );
  expect(today).toEqual(
    expect.objectContaining({ mood: null, energy: null })
  );

  const repeated = await page.request.get("/api/bootstrap");
  const repeatedEvidence = (await repeated.json()) as {
    diary: { id: string | null; persisted: boolean };
  };
  expect(repeatedEvidence.diary).toEqual(
    expect.objectContaining({ id: null, persisted: false })
  );

  await openDashboard(page);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const diaryDays = page
    .locator(".review-metrics > div")
    .filter({ hasText: "Diary days" });
  await expect(diaryDays.getByText("0/7", { exact: true })).toBeVisible();
  const reviewEvidence = page.getByRole("region", {
    name: "Evidence captured",
    exact: true
  });
  const averageMood = reviewEvidence
    .locator(".review-evidence-counts > div")
    .filter({ hasText: "Average mood" });
  const averageEnergy = reviewEvidence
    .locator(".review-evidence-counts > div")
    .filter({ hasText: "Average energy" });
  await expect(
    averageMood.getByText("Not recorded", { exact: true })
  ).toBeVisible();
  await expect(
    averageEnergy.getByText("Not recorded", { exact: true })
  ).toBeVisible();
});

test("separates all-time and Review-Period Project Invested Time", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: {
      name: "Evidence periods",
      weeklyMinutesBudget: 120
    }
  });
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json()) as { id: string };

  const bootstrap = await page.request.get("/api/bootstrap");
  const { today } = (await bootstrap.json()) as { today: string };
  const older = new Date(today);
  older.setDate(older.getDate() - 10);

  const olderActivity = await page.request.post("/api/activities", {
    data: {
      date: older.toISOString(),
      durationMinutes: 600,
      note: "Older Project evidence",
      category: "Deep Work",
      projectId: project.id
    }
  });
  expect(olderActivity.ok()).toBe(true);
  const currentActivity = await page.request.post("/api/activities", {
    data: {
      date: today,
      durationMinutes: 60,
      note: "Current Project evidence",
      category: "Deep Work",
      projectId: project.id
    }
  });
  expect(currentActivity.ok()).toBe(true);

  const summariesResponse = await page.request.get("/api/projects");
  const summaries = (await summariesResponse.json()) as Array<{
    id: string;
    investedMinutes: number;
    reviewPeriodInvestedMinutes: number;
    movedDuringReviewPeriod: boolean;
  }>;
  expect(summaries.find((summary) => summary.id === project.id)).toEqual(
    expect.objectContaining({
      investedMinutes: 660,
      reviewPeriodInvestedMinutes: 60,
      movedDuringReviewPeriod: true
    })
  );
});

test("keeps historical Activity attribution when a Task moves Projects", async ({
  page
}) => {
  const firstProject = await page.request.post("/api/projects", {
    data: { name: "Original evidence Project" }
  });
  const secondProject = await page.request.post("/api/projects", {
    data: { name: "Future work Project" }
  });
  const first = (await firstProject.json()) as { id: string };
  const second = (await secondProject.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Move after recording",
      date: null,
      projectId: first.id
    }
  });
  const task = (await taskResponse.json()) as { id: string };
  const activity = await page.request.post("/api/activities", {
    data: {
      durationMinutes: 30,
      note: "Evidence before the move",
      category: "Deep Work",
      taskId: task.id
    }
  });
  expect(activity.ok()).toBe(true);

  const move = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { projectId: second.id, phaseId: null }
  });
  expect(move.ok()).toBe(true);

  const summaries = (await (
    await page.request.get("/api/projects")
  ).json()) as Array<{ id: string; investedMinutes: number }>;
  expect(summaries.find((project) => project.id === first.id)?.investedMinutes).toBe(30);
  expect(summaries.find((project) => project.id === second.id)?.investedMinutes).toBe(0);
});

test("rejects conflicting Project attribution for Notes and Materials", async ({
  page
}) => {
  const firstProject = await page.request.post("/api/projects", {
    data: { name: "First attribution" }
  });
  const secondProject = await page.request.post("/api/projects", {
    data: { name: "Second attribution" }
  });
  expect(firstProject.ok()).toBe(true);
  expect(secondProject.ok()).toBe(true);
  const first = (await firstProject.json()) as { id: string };
  const second = (await secondProject.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Attributed task",
      date: null,
      projectId: first.id
    }
  });
  expect(taskResponse.ok()).toBe(true);
  const task = (await taskResponse.json()) as { id: string };

  const note = await page.request.post("/api/notes", {
    data: {
      content: "Conflicting note",
      taskId: task.id,
      projectId: second.id
    }
  });
  expect(note.status()).toBe(409);
  expect(await note.json()).toEqual(expect.objectContaining({
    error: "The selected task belongs to a different project."
  }));

  const material = await page.request.post("/api/materials", {
    data: {
      title: "Conflicting material",
      url: "https://example.com/evidence",
      taskId: task.id,
      projectId: second.id
    }
  });
  expect(material.status()).toBe(409);
  expect(await material.json()).toEqual(expect.objectContaining({
    error: "The selected task belongs to a different project."
  }));
});

test("records activity through the palette and shows it in the rail", async ({ page }) => {
  await openDashboard(page);
  await addTask(page, "Capture activity evidence");

  await page.getByRole("button", { name: /Search or add/ }).click();
  await page.getByRole("option", { name: /Log an activity by hand/ }).click();
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

test("captures direct Project evidence from Activity, Notes, and Materials", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Direct evidence" }
  });
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json()) as { id: string };
  await openDashboard(page);

  await page.getByRole("button", { name: /Search or add/ }).click();
  await page.getByRole("option", { name: /Log an activity by hand/ }).click();
  const activityDialog = page.getByRole("dialog", { name: "Log activity" });
  await activityDialog
    .getByPlaceholder("Record a small win or what moved forward.")
    .fill("Direct Activity evidence");
  await activityDialog.getByLabel("Project", { exact: true }).selectOption(project.id);
  const saveActivity = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/activities") &&
      response.request().method() === "POST"
  );
  await activityDialog.getByRole("button", { name: "Add activity" }).click();
  expect((await saveActivity).ok()).toBe(true);

  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  await noteForm
    .getByPlaceholder("Capture a thought, decision, or reminder.")
    .fill("Direct Note evidence");
  await noteForm.getByLabel("Project", { exact: true }).selectOption(project.id);
  const saveNote = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes") &&
      response.request().method() === "POST"
  );
  await noteForm.getByRole("button", { name: "Save note" }).click();
  expect((await saveNote).ok()).toBe(true);

  await page.getByRole("radio", { name: /References/ }).click();
  const materialForm = page
    .locator(".capture-form")
    .filter({ hasText: "Save reference" });
  await materialForm.getByPlaceholder("URL").fill("https://example.com/direct");
  await materialForm
    .getByLabel("Project", { exact: true })
    .selectOption(project.id);
  const saveMaterial = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/materials") &&
      response.request().method() === "POST"
  );
  await materialForm.getByRole("button", { name: "Save reference" }).click();
  expect((await saveMaterial).ok()).toBe(true);

  const bootstrap = await page.request.get("/api/bootstrap");
  const evidence = (await bootstrap.json()) as {
    activities: Array<{ note: string; projectId: string | null }>;
    notes: Array<{ content: string; projectId: string | null }>;
    materials: Array<{ url: string; projectId: string | null }>;
  };
  expect(
    evidence.activities.find(
      (activity) => activity.note === "Direct Activity evidence"
    )?.projectId
  ).toBe(project.id);
  expect(
    evidence.notes.find((note) => note.content === "Direct Note evidence")
      ?.projectId
  ).toBe(project.id);
  expect(
    evidence.materials.find(
      (material) => material.url === "https://example.com/direct"
    )?.projectId
  ).toBe(project.id);
});

test("uses one Backlog with Quadrant as the default and persistent task elements", async ({
  page
}) => {
  await openDashboard(page);
  await addBacklogTask(page, "Place on matrix");

  await page.getByRole("button", { name: /Backlog/ }).click();
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Priority", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("radiogroup", { name: "Arrange backlog by" })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Arrange the same 1 task by pressure, project or deadline — nothing is ever filtered out.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByText(/Tables — act here/)).toHaveCount(0);
  await expect(page.getByText("Do now", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Schedule", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Quick wins", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Later", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Place on matrix, Standalone/ })).toBeVisible();

  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await expect(
    page.getByText("Figure — position is the grouping. Hover a dot for its title.", {
      exact: true
    })
  ).toBeVisible();
  await page.getByRole("button", { name: /Place on matrix, Standalone/ }).click();
  await expect(
    page.locator(".matrix-selection-caption").getByText("Place on matrix", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator(".matrix-selection-caption").getByRole("button", { name: "Today" })
  ).toBeVisible();
});

test("caps and aligns the wide Backlog slab without recoloring focus states", async ({
  page
}) => {
  await page.setViewportSize({ width: 2560, height: 1100 });
  await openDashboard(page);
  await addBacklogTask(page, "Wide layout check");
  await page.getByRole("button", { name: /Backlog/ }).click();

  const geometry = await page.evaluate(() => {
    function rect(selector: string) {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width
      };
    }

    return {
      shell: rect(".focus-shell"),
      page: rect(".backlog-page"),
      header: rect(".backlog-page .page-header"),
      matrix: rect(".matrix-5a"),
      stage: rect(".matrix-stage"),
      heading: rect(".matrix-table-heading"),
      columns: rect(".matrix-column-heads")
    };
  });

  expect(geometry.shell.width).toBeCloseTo(1560, 0);
  expect(geometry.shell.left).toBeCloseTo((2560 - 1560) / 2, 0);
  expect(geometry.page.left).toBe(geometry.header.left);
  expect(geometry.header.width).toBeLessThanOrEqual(900);
  expect(geometry.matrix.width).toBeCloseTo(geometry.header.width, 0);
  expect(geometry.stage.width).toBeCloseTo(geometry.header.width, 0);
  expect(geometry.heading.right).toBeCloseTo(geometry.stage.right, 0);
  expect(geometry.columns.right).toBeCloseTo(geometry.stage.right, 0);

  const arrangementNote = page.locator(".backlog-arrangement-note");
  const arrangementColors = await arrangementNote.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("div");
    probe.style.cssText =
      "background: var(--surface-2); border-left: 2px solid var(--line); color: var(--muted);";
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const colors = {
      expectedBackground: expected.backgroundColor,
      expectedBorder: expected.borderLeftColor,
      expectedColor: expected.color
    };
    probe.remove();
    return {
      background: style.backgroundColor,
      border: style.borderLeftColor,
      color: style.color,
      ...colors
    };
  });
  expect(arrangementColors.background).toBe(arrangementColors.expectedBackground);
  expect(arrangementColors.border).toBe(arrangementColors.expectedBorder);
  expect(arrangementColors.color).toBe(arrangementColors.expectedColor);

  const arrangeControl = page.locator(".arrange-control");
  const controlStyle = await arrangeControl.evaluate((element) => {
    const trough = element.querySelector<HTMLElement>(".segmented-control");
    const active = element.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (!trough || !active) throw new Error("Arrange control is incomplete");
    const troughStyle = getComputedStyle(trough);
    const activeStyle = getComputedStyle(active);
    return {
      controlWidth: element.getBoundingClientRect().width,
      troughPadding: troughStyle.padding,
      troughBorder: troughStyle.border,
      troughRadius: troughStyle.borderRadius,
      troughBackground: troughStyle.backgroundColor,
      activeHeight: active.getBoundingClientRect().height,
      activeFontSize: activeStyle.fontSize,
      activeRadius: activeStyle.borderRadius,
      activeBackground: activeStyle.backgroundColor,
      activeWeight: activeStyle.fontWeight,
      activeShadow: activeStyle.boxShadow
    };
  });

  expect(controlStyle.controlWidth).toBeLessThan(390);
  expect(controlStyle.troughPadding).toBe("3px");
  expect(controlStyle.troughBorder).toBe("1px solid rgb(229, 223, 211)");
  expect(controlStyle.troughRadius).toBe("8px");
  expect(controlStyle.troughBackground).toBe("rgb(247, 244, 237)");
  expect(controlStyle.activeHeight).toBeCloseTo(26, 0);
  expect(controlStyle.activeFontSize).toBe("12px");
  expect(controlStyle.activeRadius).toBe("6px");
  expect(controlStyle.activeBackground).toBe("rgb(255, 253, 248)");
  expect(controlStyle.activeWeight).toBe("700");
  expect(controlStyle.activeShadow).toBe("rgba(54, 48, 39, 0.12) 0px 1px 2px 0px");
});

test("keeps Backlog sizing fluid, stateful, and still while resizing", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openDashboard(page);
  await addBacklogTask(page, "Fluid resize check");
  await page.getByRole("button", { name: /Backlog/ }).click();

  const widths = await page.evaluate(() => {
    const header = document
      .querySelector(".backlog-page .page-header")
      ?.getBoundingClientRect();
    const matrix = document.querySelector(".matrix-5a")?.getBoundingClientRect();
    const stage = document.querySelector(".matrix-stage")?.getBoundingClientRect();
    if (!header || !matrix || !stage) throw new Error("Backlog geometry is missing");
    return {
      header: header.width,
      matrix: matrix.width,
      stage: stage.width
    };
  });
  expect(widths.header).toBeLessThanOrEqual(900);
  expect(widths.matrix).toBeCloseTo(widths.header, 0);
  expect(widths.stage).toBeCloseTo(widths.header, 0);

  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(page.locator("html")).toHaveClass(/resizing/);
  expect(
    await page.locator(".matrix-persistent-task").first().evaluate(
      (element) => getComputedStyle(element).transitionDuration
    )
  ).toBe("0s");
  await expect(page.locator("html")).not.toHaveClass(/resizing/, {
    timeout: 1_000
  });

  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeChecked();
  const persistentTask = await page.locator(".matrix-persistent-task").first().elementHandle();
  expect(persistentTask).not.toBeNull();
  const scrollTop = await page.evaluate(() => {
    window.scrollTo(0, Math.min(220, document.documentElement.scrollHeight - innerHeight));
    return window.scrollY;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1179, height: 500 });
  await expect(page.locator("html")).toHaveAttribute("data-layout-mode", "compact");
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "true"
  );
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeChecked();
  expect(
    await persistentTask?.evaluate(
      (element) => element === document.querySelector(".matrix-persistent-task")
    )
  ).toBe(true);
  const compactScrollTop = await page.evaluate(() =>
    Math.min(window.scrollY, document.documentElement.scrollHeight - innerHeight)
  );
  expect(compactScrollTop).toBeCloseTo(
    Math.min(
      scrollTop,
      await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
    ),
    0
  );

  await page.setViewportSize({ width: 1180, height: 500 });
  await expect(page.locator("html")).toHaveAttribute("data-layout-mode", "desktop");
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeChecked();
  await expect(page.locator("html")).not.toHaveClass(/resizing/, {
    timeout: 1_000
  });

  await page.getByRole("radio", { name: "Project", exact: true }).click();
  expect(
    await page.locator(".matrix-persistent-task").first().evaluate(
      (element) => getComputedStyle(element).transitionDuration
    )
  ).not.toBe("0s");
});

test("keeps Figure through 700px and commits the fallback below it", async (
  { page },
  testInfo
) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  await addBacklogTask(page, `Figure boundary check ${testInfo.repeatEachIndex}`);
  await page.getByRole("button", { name: /Backlog/ }).click();

  const figure = () => page.getByRole("radio", { name: "Figure", exact: true });
  const quadrant = () => page.getByRole("radio", { name: "Quadrant", exact: true });

  await figure().click();
  await expect(figure()).toBeChecked();

  for (const width of [1180, 900, 760, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(figure()).toBeVisible();
    await expect(figure()).toBeChecked();
  }
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "true"
  );

  await page.setViewportSize({ width: 690, height: 900 });
  await expect(figure()).toHaveCount(0);
  await expect(quadrant()).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "false"
  );
  const compactControlGeometry = await page
    .locator(".arrange-control")
    .evaluate((control) => {
      const trough = control.querySelector<HTMLElement>(".segmented-control");
      const header = control.closest<HTMLElement>(".page-header");
      if (!trough || !header) throw new Error("Arrange control geometry is missing");
      return {
        controlWidth: control.getBoundingClientRect().width,
        troughWidth: trough.getBoundingClientRect().width,
        buttonHeights: [...trough.querySelectorAll("button")].map(
          (button) => button.getBoundingClientRect().height
        ),
        headerDirection: getComputedStyle(header).flexDirection
      };
    });
  expect(compactControlGeometry.troughWidth).toBeCloseTo(
    compactControlGeometry.controlWidth,
    0
  );
  expect(compactControlGeometry.buttonHeights).toEqual([44, 44, 44]);
  expect(compactControlGeometry.headerDirection).toBe("column");

  for (const width of [760, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(figure()).toBeVisible();
    await expect(quadrant()).toBeChecked();
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(figure()).toHaveCount(0);
  await expect(quadrant()).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "false"
  );
});

test("keeps a live focus full off Today at 1400px and strips it below", async ({
  page
}) => {
  await page.setViewportSize({ width: 1399, height: 900 });
  await openDashboard(page);
  await addTask(page, "Wide focus rail check");
  await taskRow(page, "Wide focus rail check")
    .getByRole("button", { name: "Focus 30m", exact: true })
    .click();
  await page.getByRole("button", { name: "Start 30m focus" }).click();

  await expect(page.getByRole("complementary", { name: "Focus rail" })).toBeVisible();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Active focus session" })
  ).toBeVisible();

  await page.setViewportSize({ width: 1400, height: 900 });
  const wideRail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(wideRail).toBeVisible();
  await expect(wideRail.getByRole("button", { name: "Collapse" })).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Active focus session" })
  ).toHaveCount(0);

  await page.setViewportSize({ width: 1399, height: 900 });
  const strip = page.getByRole("complementary", { name: "Active focus session" });
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "Expand focus rail" }).click();
  const expandedRail = page.getByRole("complementary", { name: "Focus rail" });
  await expect(expandedRail).toBeVisible();
  await expandedRail.getByRole("button", { name: "Collapse" }).click();
  await expect(strip).toBeVisible();
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
  const renamedProjectDialog = page.getByRole("dialog", {
    name: "Edit Complete systems course"
  });
  await expect(
    renamedProjectDialog.getByText("Saved", { exact: true })
  ).toBeVisible();
  await expect(renamedProjectDialog).toBeVisible();
  await renamedProjectDialog.getByRole("button", { name: "Cancel" }).click();
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
  const phaseName = page.getByLabel("Phase name: Foundations");
  await phaseName.fill("Foundational work");
  await phaseName.press("Meta+Enter");
  const renamedPhaseName = page.getByLabel("Phase name: Foundational work");
  await expect(
    page
      .locator(".phase-header")
      .filter({ has: renamedPhaseName })
      .getByText("Saved", { exact: true })
  ).toBeVisible();

  const addTaskPanel = page.locator(".project-plan-add");
  await addTaskPanel.getByLabel("New Project task").fill("Finish module one exercises");
  await addTaskPanel.getByLabel("Task phase").selectOption({ label: "Foundational work" });
  await addTaskPanel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page
      .locator(".project-next-actions")
      .getByRole("button", { name: "Focus 30m", exact: true })
  ).toHaveClass(/focus-button/);
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByLabel("Phase name: Foundational work") })
      .getByLabel("Task title: Finish module one exercises")
  ).toBeVisible();
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByLabel("Phase name: Foundational work") })
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

test("moves an existing Project task between Phases and back to Project tasks", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Reorganize the project plan" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };

  const foundationResponse = await page.request.post(
    `/api/projects/${project.id}/phases`,
    { data: { name: "Foundation" } }
  );
  const deliveryResponse = await page.request.post(
    `/api/projects/${project.id}/phases`,
    { data: { name: "Delivery" } }
  );
  expect(foundationResponse.status()).toBe(201);
  expect(deliveryResponse.status()).toBe(201);
  const foundation = (await foundationResponse.json()) as { id: string };

  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Choose the architecture",
      projectId: project.id,
      phaseId: foundation.id,
      date: null
    }
  });
  expect(taskResponse.status()).toBe(201);

  await openDashboard(page);
  await page.getByRole("button", { name: /Projects/ }).click();
  await page
    .getByRole("button", { name: /Reorganize the project plan/ })
    .click();

  const taskPhase = page.getByLabel("Phase for Choose the architecture");
  await expect(taskPhase).toHaveValue(foundation.id);

  await taskPhase.selectOption({ label: "Delivery" });
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByLabel("Phase name: Delivery") })
      .getByLabel("Task title: Choose the architecture")
  ).toBeVisible();

  await page
    .getByLabel("Phase for Choose the architecture")
    .selectOption({ label: "No phase" });
  await expect(
    page
      .locator(".project-phase-section")
      .filter({ has: page.getByText("Project tasks", { exact: true }) })
      .getByLabel("Task title: Choose the architecture")
  ).toBeVisible();
});

test("deletes a Project task after explicit confirmation", async ({ page }) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Remove an obsolete plan step" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };

  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Discard the obsolete draft",
      projectId: project.id,
      date: null
    }
  });
  expect(taskResponse.status()).toBe(201);

  await openDashboard(page);
  await page.getByRole("button", { name: /Projects/ }).click();
  await page
    .getByRole("button", { name: /Remove an obsolete plan step/ })
    .click();

  const deleteTask = page.getByRole("button", {
    name: "Delete task Discard the obsolete draft"
  });
  await deleteTask.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete task Discard the obsolete draft"
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByText("This permanently removes the task.", { exact: true })
  ).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Keep task", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(deleteTask).toBeFocused();

  await deleteTask.click();

  await confirmation
    .getByRole("button", { name: "Delete task", exact: true })
    .click();
  await expect(
    page.getByLabel("Task title: Discard the obsolete draft")
  ).toHaveCount(0);
  await expect(
    page.getByText("No steps yet. Add one concrete action above.", { exact: true })
  ).toBeVisible();
});

test("keeps a Project task and its confirmation open when deletion fails", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Keep a task after failure" }
  });
  const project = (await projectResponse.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Preserve this task",
      projectId: project.id,
      date: null
    }
  });
  expect(taskResponse.status()).toBe(201);

  await openDashboard(page);
  await page.getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: /Keep a task after failure/ }).click();
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 500,
        json: { error: "Task could not be deleted." }
      });
      return;
    }
    await route.continue();
  });

  await page
    .getByRole("button", { name: "Delete task Preserve this task" })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete task Preserve this task"
  });
  await confirmation
    .getByRole("button", { name: "Delete task", exact: true })
    .click();

  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByText("Task could not be deleted. Try again.", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByLabel("Task title: Preserve this task")).toHaveCount(1);
});

test("deletes a Phase while preserving its Tasks at the Project root", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Simplify the project plan" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const phaseResponse = await page.request.post(
    `/api/projects/${project.id}/phases`,
    { data: { name: "Temporary grouping" } }
  );
  expect(phaseResponse.status()).toBe(201);
  const phase = (await phaseResponse.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Keep this concrete action",
      projectId: project.id,
      phaseId: phase.id,
      date: null
    }
  });
  expect(taskResponse.status()).toBe(201);

  await openDashboard(page);
  await page.getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: /Simplify the project plan/ }).click();

  const addTaskPanel = page.locator(".project-plan-add");
  await addTaskPanel
    .getByLabel("New Project task")
    .fill("Add this after deleting the Phase");
  await addTaskPanel
    .getByLabel("Task phase")
    .selectOption({ label: "Temporary grouping" });

  await page
    .getByRole("button", { name: "Delete phase Temporary grouping" })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete phase Temporary grouping"
  });
  await expect(
    confirmation.getByText(
      "Its 1 Task will be preserved and moved to the Project root.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Keep phase", exact: true })
  ).toBeFocused();
  await confirmation
    .getByRole("button", { name: "Delete phase", exact: true })
    .click();

  await expect(page.getByLabel("Phase name: Temporary grouping")).toHaveCount(0);
  await expect(
    page
      .locator(".project-root-tasks")
      .getByLabel("Task title: Keep this concrete action")
  ).toBeVisible();
  await expect(
    page
      .locator(".project-next-step")
      .getByText(/Project root · backlog/)
  ).toBeVisible();

  const createTask = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks") &&
      response.request().method() === "POST"
  );
  await addTaskPanel.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createTask).ok()).toBe(true);
  await expect(
    page
      .locator(".project-root-tasks")
      .getByLabel("Task title: Add this after deleting the Phase")
  ).toBeVisible();
});

test("supports the redesigned Journal and Review destinations", async ({ page }) => {
  await openDashboard(page);

  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  await expect(page.getByText("Ready to save", { exact: true })).toHaveCount(0);
  const dailyPage = page.getByPlaceholder("Write a few lines about the day.");
  await dailyPage.fill("The save state belongs beside the writing.");
  await expect(
    page.locator(".journal-card-heading").getByText("Saved", { exact: true })
  ).toBeVisible();
  await page.getByRole("radio", { name: /Notes/ }).click();
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

  await page.getByRole("radio", { name: /References/ }).click();
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
  await expect(
    page.getByRole("heading", { name: "Evidence captured", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Where the time went", exact: true })
  ).toBeVisible();
  const narrative = page.getByLabel("What moved forward?", { exact: true });
  const intention = page.getByLabel("What deserves protection next?", {
    exact: true
  });
  await narrative.fill("The quiet feedback loop kept the work moving.");
  await intention.fill("Protect one uninterrupted review block.");
  const saveReview = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/review") &&
      response.request().method() === "PUT"
  );
  await intention.press("Control+Enter");
  expect((await saveReview).ok()).toBe(true);
  await expect(
    page.locator(".review-editor-heading").getByText("Saved", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: /^Today/ }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(narrative).toHaveValue(
    "The quiet feedback loop kept the work moving."
  );
  await expect(intention).toHaveValue(
    "Protect one uninterrupted review block."
  );

  const bootstrap = await page.request.get("/api/bootstrap");
  const saved = (await bootstrap.json()) as {
    diary: { content: string };
    review: { narrative: string; nextPeriodIntention: string };
  };
  expect(saved.diary.content).toBe("The save state belongs beside the writing.");
  expect(saved.review).toEqual(
    expect.objectContaining({
      narrative: "The quiet feedback loop kept the work moving.",
      nextPeriodIntention: "Protect one uninterrupted review block."
    })
  );

  await page.reload();
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByLabel("What moved forward?", { exact: true })
  ).toHaveValue("The quiet feedback loop kept the work moving.");
  await expect(
    page.getByLabel("What deserves protection next?", { exact: true })
  ).toHaveValue("Protect one uninterrupted review block.");
});

test("reaches complete Note and Material history through stable pagination", async ({
  page
}) => {
  seedJournalHistory();
  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();

  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(page.getByRole("radio", { name: "Notes · 105" })).toBeVisible();
  await expect(page.getByText("History note 104", { exact: true })).toBeVisible();
  await expect(page.getByText("History note 000", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 100 of 105 notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("History note 000", { exact: true })).toBeVisible();
  await expect(page.getByText("All 105 notes loaded.", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /References/ }).click();
  await expect(
    page.getByRole("radio", { name: "References · 105" })
  ).toBeVisible();
  await expect(
    page.getByText("History reference 104", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("History reference 000", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByText("History reference 000", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("All 105 references loaded.", { exact: true })
  ).toBeVisible();
});

test("exports complete user history without dashboard preview caps", async ({ page }) => {
  seedJournalHistory();

  const response = await page.request.get("/api/agent-export");
  expect(response.ok()).toBe(true);
  const exported = (await response.json()) as {
    exportFormat: string;
    exportVersion: number;
    notes: Array<{ id: string }>;
    materials: Array<{ id: string }>;
  };

  expect(exported.exportFormat).toBe("dayflow-json");
  expect(exported.exportVersion).toBe(1);
  expect(exported.notes).toHaveLength(105);
  expect(exported.materials).toHaveLength(105);
});

test("preserves Note and Material drafts when a write is rejected", async ({
  page
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();

  await page.route("**/api/notes", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 400,
        json: { error: "The selected Project no longer exists." }
      });
      return;
    }
    await route.continue();
  });

  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  const noteDraft = noteForm.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  const tagsDraft = noteForm.getByPlaceholder("Tags, comma separated");
  await noteDraft.fill("Keep this rejected note");
  await tagsDraft.fill("reliable, draft");
  await noteForm.getByRole("button", { name: "Save note" }).click();
  await expect(noteDraft).toHaveValue("Keep this rejected note");
  await expect(tagsDraft).toHaveValue("reliable, draft");
  await expect(
    page.getByText("The selected Project no longer exists.", { exact: true })
  ).toBeVisible();
  await page.unroute("**/api/notes");

  await page.getByRole("radio", { name: /References/ }).click();
  await page.route("**/api/materials", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 400,
        json: { error: "The selected Note no longer exists." }
      });
      return;
    }
    await route.continue();
  });

  const materialForm = page
    .locator(".capture-form")
    .filter({ hasText: "Save reference" });
  const materialTitle = materialForm.getByPlaceholder("Title");
  const materialUrl = materialForm.getByPlaceholder("URL");
  const materialNotes = materialForm.getByPlaceholder("Why this matters");
  await materialTitle.fill("Keep this rejected reference");
  await materialUrl.fill("https://example.com/rejected-reference");
  await materialNotes.fill("The form must retain all three fields.");
  await materialForm.getByRole("button", { name: "Save reference" }).click();
  await expect(materialTitle).toHaveValue("Keep this rejected reference");
  await expect(materialUrl).toHaveValue(
    "https://example.com/rejected-reference"
  );
  await expect(materialNotes).toHaveValue(
    "The form must retain all three fields."
  );
  await expect(
    page.getByText("The selected Note no longer exists.", { exact: true })
  ).toBeVisible();
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

  await addTask(page, "Phone details");
  const phoneTask = taskRow(page, "Phone details");
  await phoneTask
    .getByRole("button", { name: "Show task details: Phone details" })
    .click();
  const phoneFieldWidths = await phoneTask
    .locator(".task-controls")
    .evaluate((controls) =>
      [...controls.querySelectorAll("label")].map(
        (label) => label.getBoundingClientRect().width
      )
    );
  expect(Math.min(...phoneFieldWidths)).toBeGreaterThanOrEqual(120);
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
  await expect(page.getByRole("radio", { name: "Priority", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

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

  for (const width of [390, 619]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".nav-list .nav-item:visible")).toHaveCount(5);
    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(Math.round(navigationBox?.width ?? 0)).toBe(width);
  }

  for (const width of [620, 700, 780, 781, 900, 1179]) {
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
  await expect(page.locator("html")).toHaveAttribute("data-layout-mode", "desktop");
  const desktopSidebarBox = await sidebar.boundingBox();
  const desktopWorkspaceBox = await workspace.boundingBox();
  expect(Math.round(desktopSidebarBox?.width ?? 0)).toBe(196);
  expect(
    (desktopSidebarBox?.x ?? 0) + (desktopSidebarBox?.width ?? 0)
  ).toBeLessThanOrEqual((desktopWorkspaceBox?.x ?? 0) + 1);
});

test("stamps the layout mode before hydration, with no app bundle at all", async ({
  page
}) => {
  // Every other layout-mode assertion runs after hydration, so useLayoutMode's
  // effect can satisfy them even when the pre-paint script is broken. Blocking
  // fetched scripts leaves the inline script as the only thing that can set
  // these attributes. If layoutBreakpoints regresses to an import from a
  // "use client" module it serializes as `undefined`, the script throws into
  // its own catch, and nothing is stamped -- which this catches.
  await page.route("**/*", (route) =>
    route.request().resourceType() === "script"
      ? route.abort()
      : route.continue()
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-layout-mode",
    "phone"
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "false"
  );

  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-layout-mode",
    "desktop"
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-figure-arrangement",
    "true"
  );
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
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeVisible();
});
