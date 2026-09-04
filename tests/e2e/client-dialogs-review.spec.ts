import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetTestDatabase, setFocusSessionElapsedMinutes } from "./database";
import type { FocusSessionRecord, FocusSnapshot } from "../../src/lib/focus-domain";
import type { AutomaticBackupState } from "../../src/lib/automatic-backup-contract";

// These selectors and wire fixtures also apply before the client-file split.
test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetTestDatabase());

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", {
    name: /(tasks? left|Nothing scheduled yet|All done for today)$/
  })).toBeVisible({ timeout: 30_000 });
}

const focusRail = (page: Page) =>
  page.getByRole("complementary", { name: "Focus rail", exact: true });

function responseFor(page: Page, pathname: string, method: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname &&
    response.request().method() === method
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function clickOutside(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x > 1 || box!.y > 1).toBe(true);
  await page.mouse.click(1, 1);
}

function backup(id: string, status: "verified" | "invalid" = "verified") {
  return {
    id,
    fileName: `${id}.dayflow-backup`,
    path: `/test-backups/${id}.dayflow-backup`,
    createdAt: "2026-09-04T12:00:00.000Z",
    applicationVersion: "1.0.0",
    schemaVersion: "test-schema",
    sizeBytes: 2048,
    payloadBytes: 1024,
    payloadSha256: "a".repeat(64),
    totalRecords: 2,
    recordCounts: { Task: 2 },
    status,
    ...(status === "invalid" ? { error: "Backup checksum does not match." } : {})
  };
}

async function mockBackupIndex(page: Page) {
  const response = await page.request.get("/api/backups");
  expect(response.status()).toBe(200);
  const initial = await response.json() as { automatic: AutomaticBackupState };
  const index = {
    directory: "/test-backups",
    automatic: initial.automatic,
    backups: [backup("newer-copy"), backup("older-copy"), backup("damaged-copy", "invalid")],
    pendingRestore: null as Record<string, unknown> | null,
    lastRestore: null
  };
  const requests = { gets: 0 };
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    requests.gets += 1;
    await route.fulfill({ status: 200, json: index });
  });
  return { index, requests };
}

async function openBackups(page: Page) {
  await openDashboard(page);
  const opener = page.getByRole("button", { name: "Data & backups", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Data & backups", exact: true });
  await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  return { dialog, opener };
}

async function openRestore(page: Page, dialog: Locator) {
  const trigger = dialog.getByRole("button", { name: "Restore this backup…", exact: true });
  await trigger.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Restore this backup on next startup?", exact: true
  });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  return { confirmation, trigger };
}

test("backup selection and Refresh preserve a present selection and replace a removed one", async ({ page }) => {
  const { index, requests } = await mockBackupIndex(page);
  const { dialog } = await openBackups(page);
  const list = dialog.getByRole("region", { name: "Available backups", exact: true });
  const details = dialog.getByRole("region", { name: "Backup details", exact: true });
  const older = list.getByRole("button", { name: /^older-copy\.dayflow-backup/ });
  await older.click();
  await expect(older).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("button", { name: /^newer-copy\.dayflow-backup/ })).toHaveAttribute("aria-pressed", "false");
  await expect(details.getByRole("heading", { name: "older-copy.dayflow-backup" })).toBeVisible();
  await expect(details.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
    "href", "/api/backups/older-copy/download"
  );

  index.backups[1].applicationVersion = "refreshed-version";
  const refresh = responseFor(page, "/api/backups", "GET");
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  expect((await refresh).status()).toBe(200);
  await expect(details.getByText("refreshed-version", { exact: true })).toBeVisible();
  await expect(older).toHaveAttribute("aria-pressed", "true");
  expect(requests.gets).toBe(2);

  index.backups = index.backups.filter((item) => item.id !== "older-copy");
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(older).toHaveCount(0);
  await expect(details.getByRole("heading", { name: "newer-copy.dayflow-backup" })).toBeVisible();
  await expect(list.getByRole("button", { name: /^newer-copy\.dayflow-backup/ })).toHaveAttribute("aria-pressed", "true");
  expect(requests.gets).toBe(3);
});

test("an invalid backup can be inspected but cannot restore or download", async ({ page }) => {
  await mockBackupIndex(page);
  const { dialog } = await openBackups(page);
  const invalid = dialog.getByRole("region", { name: "Available backups", exact: true })
    .getByRole("button", { name: /^damaged-copy\.dayflow-backup/ });
  await invalid.click();
  await expect(invalid).toHaveAttribute("aria-pressed", "true");
  const details = dialog.getByRole("region", { name: "Backup details", exact: true });
  await expect(details.getByRole("heading", { name: "damaged-copy.dayflow-backup" })).toBeVisible();
  await expect(details.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(details.getByText("Backup checksum does not match.", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "Restore this backup…", exact: true })).toBeDisabled();
  // The existing UI omits the link entirely for invalid backups.
  await expect(details.getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
});

test("both backup error Dismiss buttons clear only the error and retain the dialog draft", async ({ page }) => {
  await mockBackupIndex(page);
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 500, json: { error: "The backup could not be created." } });
  });
  await page.route("**/api/backups/restore", (route) => route.fulfill({
    status: 409, json: { error: "The selected backup changed after it was inspected. Refresh and try again." }
  }));
  const { dialog } = await openBackups(page);
  await dialog.getByRole("button", { name: "Create backup", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("The backup could not be created.");
  await dialog.getByRole("alert").getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  const { confirmation } = await openRestore(page, dialog);
  const input = confirmation.getByLabel("Type RESTORE to schedule replacement", { exact: true });
  await input.fill("RESTORE");
  await confirmation.getByRole("button", { name: "Restore on next startup", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toContainText("The selected backup changed");
  await confirmation.getByRole("alert").getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toHaveCount(0);
  await expect(confirmation).toBeVisible();
  await expect(input).toHaveValue("RESTORE");
  await expect(confirmation.getByRole("button", { name: "Restore on next startup", exact: true })).toBeEnabled();
});

test("outer backup Tab trapping and both dialog backdrops restore focus on dismissal", async ({ page }) => {
  await mockBackupIndex(page);
  const { dialog, opener } = await openBackups(page);
  const close = dialog.getByRole("button", { name: "Close data and backups", exact: true });
  const restore = dialog.getByRole("button", { name: "Restore this backup…", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(restore).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await dialog.getByRole("heading", { name: "Data & backups", exact: true }).click();
  await expect(dialog).toBeVisible();

  const { confirmation } = await openRestore(page, dialog);
  await confirmation.getByLabel("Type RESTORE to schedule replacement", { exact: true }).fill("RESTORE");
  await confirmation.getByRole("heading", { name: "Restore this backup on next startup?", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await clickOutside(page, confirmation);
  await expect(confirmation).toHaveCount(0);
  await expect(restore).toBeFocused();
  await restore.click();
  await expect(confirmation.getByLabel("Type RESTORE to schedule replacement", { exact: true })).toHaveValue("");
  await clickOutside(page, confirmation);
  await expect(restore).toBeFocused();
  await clickOutside(page, dialog);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Escape and backdrop clicks are suppressed during create, stage and cancel mutations", async ({ page }) => {
  const { index } = await mockBackupIndex(page);
  const creating = deferred();
  const staging = deferred();
  const canceling = deferred();
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await creating.promise;
    const created = backup("created-copy");
    index.backups.unshift(created);
    await route.fulfill({ status: 201, json: { backup: created } });
  });
  await page.route("**/api/backups/restore", async (route) => {
    if (route.request().method() === "POST") {
      await staging.promise;
      const payload = route.request().postDataJSON();
      index.pendingRestore = {
        version: 1, status: "pending_restart", backupId: payload.backupId,
        fileName: "created-copy.dayflow-backup", expectedPayloadSha256: payload.expectedPayloadSha256,
        scheduledAt: "2026-09-04T12:00:00.000Z"
      };
      await route.fulfill({ status: 202, json: index });
    } else if (route.request().method() === "DELETE") {
      await canceling.promise;
      index.pendingRestore = null;
      await route.fulfill({ status: 200, json: index });
    } else {
      await route.continue();
    }
  });
  try {
    const { dialog } = await openBackups(page);
    await dialog.getByRole("button", { name: "Create backup", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Creating backup…");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await clickOutside(page, dialog);
    await expect(dialog).toBeVisible();
    creating.resolve();
    await expect(dialog.getByRole("status")).toHaveText("Backup created and verified.");
    await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();

    const { confirmation } = await openRestore(page, dialog);
    await confirmation.getByLabel("Type RESTORE to schedule replacement", { exact: true }).fill("RESTORE");
    await confirmation.getByRole("button", { name: "Restore on next startup", exact: true }).click();
    await expect(confirmation.getByRole("status")).toHaveText("Scheduling restore…");
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await clickOutside(page, confirmation);
    await expect(confirmation).toBeVisible();
    staging.resolve();
    await expect(confirmation).toHaveCount(0);
    const pending = dialog.getByRole("region", { name: "Pending restore", exact: true });
    await pending.getByRole("button", { name: "Cancel pending restore", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Canceling restore…");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    canceling.resolve();
    await expect(pending).toHaveCount(0);
    await expect(dialog.getByRole("status")).toHaveText("Pending restore canceled. The current data will stay active.");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    creating.resolve(); staging.resolve(); canceling.resolve();
  }
});

type TaskFixture = { id: string; title: string; estimateMinutes: number };

async function createTask(page: Page, title: string, projectId: string | null = null) {
  const response = await page.request.post("/api/tasks", {
    data: { title, date: null, projectId, estimateMinutes: 17 }
  });
  expect(response.status()).toBe(201);
  return await response.json() as TaskFixture;
}

async function startSession(page: Page, input: {
  kind?: "FOCUS" | "BREAK"; taskId?: string; label?: string; plannedMinutes?: number;
} = {}) {
  const response = await page.request.post("/api/focus-session", {
    data: { kind: "FOCUS", plannedMinutes: 25, label: "Review fixture focus", ...input }
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { session: FocusSessionRecord }).session;
}

async function transition(page: Page, id: string, action: string) {
  const response = await page.request.patch(`/api/focus-session/${id}`, { data: { action } });
  expect(response.status()).toBe(200);
  return await response.json() as { snapshot: FocusSnapshot; completedSession: FocusSessionRecord };
}

async function snapshot(page: Page) {
  const response = await page.request.get("/api/focus-session");
  expect(response.status()).toBe(200);
  return await response.json() as FocusSnapshot;
}

async function queueTask(page: Page, task: TaskFixture) {
  const response = await page.request.post("/api/focus-queue", {
    data: { taskId: task.id, placement: "end" }
  });
  expect(response.status()).toBe(200);
}

async function seedQueue(page: Page) {
  const first = await createTask(page, "Queued alpha");
  const second = await createTask(page, "Queued beta");
  await queueTask(page, first);
  await queueTask(page, second);
  const session = await startSession(page);
  return { first, second, session };
}

async function expectQueue(rail: Locator, titles: string[]) {
  // The remove controls retain their DOM order in both normal and reorder modes.
  await expect(rail.getByRole("button", { name: /^Remove .+ from queue$/ })).toHaveCount(titles.length);
  await expect.poll(() => rail.getByRole("button", { name: /^Remove .+ from queue$/ })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
    .toEqual(titles.map((title) => `Remove ${title} from queue`));
}

async function assertNoActivity(page: Page) {
  const response = await page.request.get("/api/bootstrap");
  expect(response.status()).toBe(200);
  expect((await response.json() as { activities: unknown[] }).activities).toEqual([]);
}

const breakTitle = "Break — stand up";

test("direct Focus Task and Project choices clear inherited attribution before starting", async ({ page }) => {
  const projects = [] as Array<{ id: string; name: string }>;
  for (const name of ["Direct project", "Inherited project"]) {
    const response = await page.request.post("/api/projects", { data: { name } });
    expect(response.status()).toBe(201);
    projects.push(await response.json());
  }
  const linked = await createTask(page, "Project-linked task", projects[1].id);
  const standalone = await createTask(page, "Standalone choice");
  await openDashboard(page);
  const rail = focusRail(page);
  const task = rail.getByLabel("Focus task", { exact: true });
  const project = rail.getByLabel("Focus project", { exact: true });
  await task.selectOption("");
  await project.selectOption(projects[0].id);
  await task.selectOption(linked.id);
  await expect(project).toHaveCount(0);
  await expect(rail.getByText("Project · Inherited project", { exact: true })).toBeVisible();
  const inheritedStart = responseFor(page, "/api/focus-session", "POST");
  await rail.getByRole("button", { name: "Start 25m focus", exact: true }).click();
  const inheritedResponse = await inheritedStart;
  expect(inheritedResponse.status()).toBe(201);
  expect(inheritedResponse.request().postDataJSON()).toEqual({
    kind: "FOCUS", plannedMinutes: 25, taskId: linked.id, projectId: null
  });
  expect((await inheritedResponse.json()).session.task.project.id).toBe(projects[1].id);
  await rail.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(task).toBeVisible();

  // Choose an explicit Project, then a linked Task: the inherited selection
  // must discard that explicit Project when switching to a standalone Task.
  await task.selectOption("");
  await project.selectOption(projects[0].id);
  await task.selectOption(linked.id);
  await task.selectOption(standalone.id);
  await expect(project).toHaveValue("");
  await expect(rail.getByText("Project · Inherited project", { exact: true })).toHaveCount(0);
  await project.selectOption(projects[0].id);
  const directStart = responseFor(page, "/api/focus-session", "POST");
  await rail.getByRole("button", { name: "Start 25m focus", exact: true }).click();
  const directResponse = await directStart;
  expect(directResponse.status()).toBe(201);
  expect(directResponse.request().postDataJSON()).toEqual({
    kind: "FOCUS", plannedMinutes: 25, taskId: standalone.id, projectId: projects[0].id
  });
  expect((await directResponse.json()).session.projectId).toBe(projects[0].id);
  await rail.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(task).toBeVisible();

  await task.selectOption(linked.id);
  await task.selectOption("");
  await expect(project).toHaveValue("");
  await project.selectOption(projects[0].id);
  await project.selectOption("");
  const clearedStart = responseFor(page, "/api/focus-session", "POST");
  await rail.getByRole("button", { name: "Start 25m focus", exact: true }).click();
  const clearedResponse = await clearedStart;
  expect(clearedResponse.status()).toBe(201);
  expect(clearedResponse.request().postDataJSON()).toEqual({
    kind: "FOCUS", plannedMinutes: 25, taskId: null, projectId: null
  });
});

test("queue Task selection and Add append the Task and reset the chooser", async ({ page }) => {
  const available = await createTask(page, "Chosen in the rail");
  const session = await startSession(page);
  await openDashboard(page);
  const rail = focusRail(page);
  const select = rail.getByLabel("Add to queue", { exact: true });
  const add = rail.getByRole("button", { name: "Add", exact: true });
  await expect(select).toHaveAttribute("id", `focus-queue-add-${session.id}`);
  await expect(add).toBeDisabled();
  await select.selectOption(available.id);
  await expect(add).toBeEnabled();
  const added = responseFor(page, "/api/focus-queue", "POST");
  await add.click();
  const response = await added;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ taskId: available.id, placement: "end" });
  await expectQueue(rail, [breakTitle, available.title]);
  await expect(select).toHaveValue("");
  await expect(select.getByRole("option", { name: available.title, exact: true })).toHaveCount(0);
  await expect(add).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Chosen in the rail, added to the queue." })).toBeVisible();
});

test("queue drag and drop persists order and Escape returns focus to Reorder", async ({ page }) => {
  const { first, second } = await seedQueue(page);
  await openDashboard(page);
  const rail = focusRail(page);
  await expectQueue(rail, [breakTitle, first.title, second.title]);
  // In normal mode each remove button's parent is its draggable queue entry.
  const source = rail.getByRole("button", { name: `Remove ${second.title} from queue`, exact: true }).locator("..");
  const target = rail.getByRole("button", { name: `Remove ${first.title} from queue`, exact: true }).locator("..");
  const reordered = responseFor(page, "/api/focus-queue", "PATCH");
  await source.dragTo(target);
  const response = await reordered;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({
    ids: [second.id, first.id], expectedIds: [first.id, second.id]
  });
  await expectQueue(rail, [breakTitle, second.title, first.title]);
  await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  await rail.getByRole("button", { name: `Move ${second.title} up`, exact: true }).focus();
  await page.keyboard.press("Escape");
  const reorder = rail.getByRole("button", { name: "Reorder", exact: true });
  await expect(reorder).toBeFocused();
  await expect(reorder).toHaveAttribute("aria-pressed", "false");
  await expect(rail.getByRole("button", { name: `Move ${second.title} up`, exact: true })).toHaveCount(0);
  await expectQueue(rail, [breakTitle, second.title, first.title]);
  await page.reload();
  await expectQueue(focusRail(page), [breakTitle, second.title, first.title]);
});

test("failed keyboard queue reorders restore Task and Break order without losing focus", async ({ page }) => {
  const { first, second } = await seedQueue(page);
  await openDashboard(page);
  const rail = focusRail(page);
  await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  for (const move of [
    { name: `Move ${second.title} up`, optimistic: [breakTitle, second.title, first.title], ids: [second.id, first.id] },
    { name: `Move ${breakTitle} down`, optimistic: [first.title, breakTitle, second.title], ids: [first.id, second.id] }
  ]) {
    const release = deferred();
    await page.route("**/api/focus-queue", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await release.promise;
      await route.fulfill({ status: 409, json: { error: "The focus queue changed. Refresh and retry." } });
    });
    try {
      const button = rail.getByRole("button", { name: move.name, exact: true });
      await button.focus();
      const failed = responseFor(page, "/api/focus-queue", "PATCH");
      await page.keyboard.press("Enter");
      await expectQueue(rail, move.optimistic);
      release.resolve();
      const response = await failed;
      expect(response.status()).toBe(409);
      expect(response.request().postDataJSON()).toEqual({ ids: move.ids, expectedIds: [first.id, second.id] });
      await expect(page.getByText("Couldn’t save the new queue order. Retry the move.", { exact: true })).toBeVisible();
      await expectQueue(rail, [breakTitle, first.title, second.title]);
      await expect(button).toBeFocused();
      await expect(button).toBeEnabled();
    } finally {
      release.resolve();
      await page.unroute("**/api/focus-queue");
    }
  }
  await page.keyboard.press("Escape");
  await expect(rail.getByRole("button", { name: "Reorder", exact: true })).toBeFocused();
  await page.reload();
  await expectQueue(focusRail(page), [breakTitle, first.title, second.title]);
});

test("completion continues to a queued Task and carries the Break behind the remaining Task", async ({ page }) => {
  const { first, second, session } = await seedQueue(page);
  setFocusSessionElapsedMinutes(session.id, 3);
  await openDashboard(page);
  const rail = focusRail(page);
  await rail.getByRole("button", { name: "Reorder", exact: true }).click();
  for (const order of [
    [first.title, breakTitle, second.title],
    [first.title, second.title, breakTitle]
  ]) {
    const moved = responseFor(page, "/api/focus-queue", "PATCH");
    await rail.getByRole("button", { name: `Move ${breakTitle} down`, exact: true }).click();
    expect((await moved).status()).toBe(200);
    await expectQueue(rail, order);
  }
  await rail.getByRole("button", { name: "Done", exact: true }).click();
  await rail.getByRole("button", { name: /^Finish( \d+m)?$/ }).click();
  await expect(rail.getByRole("heading", { name: "3m counted", exact: true })).toBeVisible();
  const enriched = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
  const continued = responseFor(page, "/api/focus-session", "POST");
  await rail.getByRole("button", { name: `Continue to ${first.title}`, exact: true }).click();
  const enrichment = await enriched;
  expect(enrichment.status()).toBe(200);
  expect(enrichment.request().postDataJSON()).toEqual({
    action: "enrich", note: "", category: "Deep Work", taskCompleted: false
  });
  const response = await continued;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({
    kind: "FOCUS", plannedMinutes: first.estimateMinutes, label: first.title, taskId: first.id, projectId: null
  });
  await expect(rail.getByRole("heading", { name: first.title, exact: true })).toBeVisible();
  await expectQueue(rail, [second.title, breakTitle]);
  await expect(rail.getByText(`Finishing this session starts ${second.title} unless you change it.`, { exact: true })).toBeVisible();
  const persisted = await snapshot(page);
  expect(persisted.active?.taskId).toBe(first.id);
  expect(persisted.pendingCompletion).toBeNull();
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  expect(bootstrapResponse.status()).toBe(200);
  const bootstrap = await bootstrapResponse.json() as { activities: Array<{ focusSessionId: string | null }> };
  expect(bootstrap.activities.filter((activity) => activity.focusSessionId === session.id)).toEqual([
    expect.objectContaining({ durationMinutes: 3, origin: "FOCUS" })
  ]);
});

for (const action of ["End break", "Start next"] as const) {
  test(`Break ${action} completes recovery without recording Break activity`, async ({ page }) => {
    const first = await createTask(page, "After the break");
    const second = await createTask(page, "Later in the queue");
    await queueTask(page, first);
    await queueTask(page, second);
    const session = await startSession(page, { kind: "BREAK", label: "Break", plannedMinutes: 5 });
    await openDashboard(page);
    const rail = focusRail(page);
    await expect(rail.getByRole("heading", { name: "Break", exact: true })).toBeVisible();
    const completed = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
    const started = action === "Start next" ? responseFor(page, "/api/focus-session", "POST") : null;
    await rail.getByRole("button", { name: action, exact: true }).click();
    const completion = await completed;
    expect(completion.status()).toBe(200);
    expect(completion.request().postDataJSON()).toEqual({ action: "complete" });
    if (started) {
      const response = await started;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON()).toEqual({
        kind: "FOCUS", plannedMinutes: first.estimateMinutes, taskId: first.id, label: first.title, projectId: null
      });
      await expect(rail.getByRole("heading", { name: first.title, exact: true })).toBeVisible();
      await expectQueue(rail, [breakTitle, second.title]);
      expect((await snapshot(page)).active?.taskId).toBe(first.id);
    } else {
      await expect(rail.getByText("Start a focus session", { exact: true })).toBeVisible();
      const persisted = await snapshot(page);
      expect(persisted.active).toBeNull();
      expect(persisted.pendingCompletion).toBeNull();
      const bootstrapResponse = await page.request.get("/api/bootstrap");
      expect(bootstrapResponse.status()).toBe(200);
      const bootstrap = await bootstrapResponse.json() as { tasks: Array<{ id: string; focusQueuePosition: number | null }> };
      expect(bootstrap.tasks.find((task) => task.id === first.id)?.focusQueuePosition).toBe(0);
      expect(bootstrap.tasks.find((task) => task.id === second.id)?.focusQueuePosition).toBe(1);
    }
    await assertNoActivity(page);
  });
}

test("full-running Pause freezes the session and paused Finish records its elapsed minutes", async ({ page }) => {
  const session = await startSession(page);
  await openDashboard(page);
  const rail = focusRail(page);
  const paused = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
  await rail.getByRole("button", { name: "Pause", exact: true }).click();
  const response = await paused;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ action: "pause" });
  expect((await response.json()).snapshot.active.status).toBe("PAUSED");
  await expect(rail.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(rail.getByText(/Nothing is being recorded\./)).toBeVisible();
  // Existing helper retains PAUSED status and keeps this interval within today.
  setFocusSessionElapsedMinutes(session.id, 3);
  await page.reload();
  const completed = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
  await rail.getByRole("button", { name: "Finish 3m", exact: true }).click();
  const completion = await completed;
  expect(completion.status()).toBe(200);
  expect(completion.request().postDataJSON()).toEqual({ action: "complete" });
  await expect(rail.getByRole("heading", { name: "3m counted", exact: true })).toBeVisible();
  const persisted = await snapshot(page);
  expect(persisted.active).toBeNull();
  expect(persisted.pendingCompletion?.actualMinutes).toBe(3);
  expect(persisted.today.focusedMinutes).toBe(3);
});

test("paused Cancel preserves the session when declined and discards it when confirmed", async ({ page }) => {
  const session = await startSession(page);
  await transition(page, session.id, "pause");
  setFocusSessionElapsedMinutes(session.id, 3);
  await openDashboard(page);
  const rail = focusRail(page);
  await expect(rail.getByRole("button", { name: "Finish 3m", exact: true })).toBeVisible();
  let cancelRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/focus-session/${session.id}` && request.method() === "PATCH") {
      cancelRequests += 1;
    }
  });
  for (const accept of [false, true]) {
    const dialogEvent = page.waitForEvent("dialog");
    const clicked = rail.getByRole("button", { name: "Cancel", exact: true }).click();
    const confirmation = await dialogEvent;
    expect(confirmation.type()).toBe("confirm");
    expect(confirmation.message()).toBe("Cancel this focus block? 3m of focus will not be recorded.");
    if (accept) await confirmation.accept();
    else await confirmation.dismiss();
    await clicked;
    if (!accept) {
      await expect(rail.getByRole("button", { name: "Finish 3m", exact: true })).toBeVisible();
      expect((await snapshot(page)).active).toEqual(expect.objectContaining({ id: session.id, status: "PAUSED" }));
      expect(cancelRequests).toBe(0);
    } else {
      await expect(rail.getByText("Start a focus session", { exact: true })).toBeVisible();
      expect(cancelRequests).toBe(1);
      const persisted = await snapshot(page);
      expect(persisted.active).toBeNull();
      expect(persisted.pendingCompletion).toBeNull();
    }
  }
  await assertNoActivity(page);
});

test("strip Resume restarts a paused session and strip Finish opens completion details", async ({ page }) => {
  const session = await startSession(page);
  await transition(page, session.id, "pause");
  await openDashboard(page);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  const strip = page.getByRole("complementary", { name: "Active focus session", exact: true });
  const resumed = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
  await strip.getByRole("button", { name: "Resume timer", exact: true }).click();
  const response = await resumed;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ action: "resume" });
  await expect(strip.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
  expect((await snapshot(page)).active?.status).toBe("RUNNING");
  setFocusSessionElapsedMinutes(session.id, 3);
  const completed = responseFor(page, `/api/focus-session/${session.id}`, "PATCH");
  await strip.getByRole("button", { name: "Finish timer", exact: true }).click();
  const completion = await completed;
  expect(completion.status()).toBe(200);
  expect(completion.request().postDataJSON()).toEqual({ action: "complete" });
  const completedStrip = page.getByRole("complementary", { name: "Completed focus session", exact: true });
  await expect(completedStrip.getByRole("button", { name: "Add focus details", exact: true })).toBeVisible();
  await expect(completedStrip.getByText("Done", { exact: true })).toBeVisible();
  await completedStrip.getByRole("button", { name: "Add focus details", exact: true }).click();
  await expect(focusRail(page).getByRole("heading", { name: "3m counted", exact: true })).toBeVisible();
  expect((await snapshot(page)).pendingCompletion?.id).toBe(session.id);
});

test("automatic policy failure rolls back the toggle and suppresses Escape while saving", async ({ page }) => {
  await mockBackupIndex(page);
  const release = deferred();
  await page.route("**/api/backups/automatic", async (route) => {
    await release.promise;
    await route.fulfill({ status: 500, json: { error: "Automatic backups could not be updated." } });
  });
  try {
    const { dialog } = await openBackups(page);
    const policy = dialog.getByRole("region", { name: "Automatic backups", exact: true });
    const toggle = policy.getByRole("checkbox");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expect(policy.getByText("Saving automatic backup settings…", { exact: true })).toBeVisible();
    await expect(policy.getByLabel("Every", { exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release.resolve();
    await expect(dialog.getByRole("alert")).toContainText("Automatic backups could not be updated.");
    await expect(toggle).not.toBeChecked();
    await expect(policy.getByText("Off", { exact: true })).toBeVisible();
    await expect(policy.getByLabel("Every", { exact: true })).toBeDisabled();
    await expect(policy.getByLabel("Keep", { exact: true })).toBeDisabled();
    await expect(policy.getByText("Not scheduled", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    release.resolve();
  }
});

test("CSV downloads keep independent busy controls while both exports are in flight", async ({ page }) => {
  await mockBackupIndex(page);
  const release = { tasks: deferred(), activities: deferred() };
  const requests = { tasks: 0, activities: 0 };
  for (const kind of ["tasks", "activities"] as const) {
    await page.route(`**/api/exports/${kind}`, async (route) => {
      requests[kind] += 1;
      // Keep the existing server's CSV body and metadata contract intact.
      const response = await route.fetch();
      await release[kind].promise;
      await route.fulfill({ response });
    });
  }
  try {
    const { dialog } = await openBackups(page);
    await dialog.getByRole("button", { name: "Download Tasks CSV", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Preparing Tasks…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Download Activities CSV", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Download Activities CSV", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Preparing Activities…", exact: true })).toBeDisabled();
    await expect.poll(() => requests).toEqual({ tasks: 1, activities: 1 });
    const taskDownload = page.waitForEvent("download");
    release.tasks.resolve();
    expect((await taskDownload).suggestedFilename()).toMatch(/^dayflow-tasks-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(dialog.getByRole("button", { name: "Download Tasks CSV", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Preparing Activities…", exact: true })).toBeDisabled();
    const activityDownload = page.waitForEvent("download");
    release.activities.resolve();
    expect((await activityDownload).suggestedFilename()).toMatch(/^dayflow-activities-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(dialog.getByRole("button", { name: "Download Activities CSV", exact: true })).toBeEnabled();
    expect(requests).toEqual({ tasks: 1, activities: 1 });
  } finally {
    release.tasks.resolve(); release.activities.resolve();
  }
});

test("notification denial hides the permission prompt without preventing focus", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "default";
        static async requestPermission() {
          document.documentElement.dataset.notificationRequests = String(
            Number(document.documentElement.dataset.notificationRequests ?? "0") + 1
          );
          this.permission = "denied";
          return "denied";
        }
      }
    });
  });
  await openDashboard(page);
  const rail = focusRail(page);
  const permission = rail.getByRole("button", { name: "Enable completion alert", exact: true });
  await permission.click();
  await expect(permission).toHaveCount(0);
  expect(await page.evaluate(() => Notification.permission)).toBe("denied");
  expect(await page.evaluate(() => document.documentElement.dataset.notificationRequests)).toBe("1");
  const started = responseFor(page, "/api/focus-session", "POST");
  await rail.getByRole("button", { name: "Start 25m focus", exact: true }).click();
  expect((await started).status()).toBe(201);
  await expect(rail.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});
