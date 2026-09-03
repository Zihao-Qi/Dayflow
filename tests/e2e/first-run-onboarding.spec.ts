import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openFirstRun(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("dayflow-first-run-seen");
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Nothing here yet", exact: true })
  ).toBeVisible({ timeout: 30_000 });
  return page.locator(".first-run-page");
}

async function readBootstrap(page: Page) {
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    workspaceEmpty: boolean;
    tasks: Array<{ id: string; title: string }>;
    paletteTasks: Array<{ id: string; title: string }>;
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test("uses global workspace readiness instead of windowed bootstrap records", async ({
  page
}) => {
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "Historical completed task",
      date: "2020-01-02",
      status: "DONE"
    }
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };

  const bootstrap = await readBootstrap(page);
  expect(bootstrap.workspaceEmpty).toBe(false);
  expect(bootstrap.tasks.some(({ id }) => id === task.id)).toBe(false);
  expect(bootstrap.paletteTasks.some(({ id }) => id === task.id)).toBe(false);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
    timeout: 30_000
  });
  await expect(
    page.getByRole("heading", { name: "Nothing here yet", exact: true })
  ).toHaveCount(0);
});

test("hands the first-task draft to Projects and back without losing it", async ({
  page
}) => {
  const onboarding = await openFirstRun(page);
  const firstTask = onboarding.getByLabel(
    "What are you working on right now?"
  );
  await firstTask.fill("Draft that should survive");

  const projectHandoff = onboarding.getByRole("button", {
    name: /Group work under a project/
  });
  await projectHandoff.focus();
  await projectHandoff.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Projects", exact: true })
  ).toBeVisible();
  const createDialog = page.getByRole("dialog", { name: "Create project" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.locator("#new-project-name")).toBeFocused();
  expect((await readBootstrap(page)).workspaceEmpty).toBe(true);

  await page.keyboard.press("Escape");
  await expect(createDialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New project", exact: true })
  ).toBeFocused();

  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(
    page.getByRole("heading", { name: "Nothing here yet", exact: true })
  ).toBeVisible();
  await expect(
    page.getByLabel("What are you working on right now?")
  ).toHaveValue("Draft that should survive");
});

test("opens Capture with focus and restores the onboarding control on Escape", async ({
  page
}) => {
  const onboarding = await openFirstRun(page);
  const firstTask = onboarding.getByLabel(
    "What are you working on right now?"
  );
  await firstTask.fill("Another preserved draft");

  const captureHandoff = onboarding.getByRole("button", {
    name: /Capture anything/
  });
  await captureHandoff.focus();
  await captureHandoff.press("Enter");

  const palette = page.getByRole("dialog", { name: "Search or add" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  expect((await readBootstrap(page)).workspaceEmpty).toBe(true);

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(captureHandoff).toBeFocused();
  await expect(firstTask).toHaveValue("Another preserved draft");
});

test("keeps and idempotently retries the first task after a lost success", async ({
  page
}) => {
  let hideFirstSuccess = true;
  let releaseFirstRequest = () => {};
  let reportFirstRequest = () => {};
  const firstRequestReleased = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const firstRequestStarted = new Promise<void>((resolve) => {
    reportFirstRequest = resolve;
  });
  const mutationIds: string[] = [];
  await page.route("**/api/tasks", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    mutationIds.push(
      (await request.headerValue("X-Dayflow-Mutation-Id")) ?? ""
    );
    if (hideFirstSuccess) {
      hideFirstSuccess = false;
      reportFirstRequest();
      await firstRequestReleased;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary test failure." })
      });
      return;
    }
    await route.continue();
  });

  const onboarding = await openFirstRun(page);
  const title = "Retry my first task";
  const firstTask = onboarding.getByLabel(
    "What are you working on right now?"
  );
  const begin = onboarding.getByRole("button", {
    name: "Focus on it for 25m",
    exact: true
  });
  const projectHandoff = onboarding.getByRole("button", {
    name: /Group work under a project/
  });
  const captureHandoff = onboarding.getByRole("button", {
    name: /Capture anything/
  });
  await firstTask.fill(title);
  await begin.click();

  await firstRequestStarted;
  await expect(projectHandoff).toBeDisabled();
  await expect(captureHandoff).toBeDisabled();
  releaseFirstRequest();
  await expect(page.locator(".app-error-toast")).toContainText(
    "Temporary test failure."
  );
  await expect(firstTask).toHaveValue(title);
  await expect(begin).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("dayflow-first-run-seen")
    )
  ).toBeNull();

  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks") &&
      response.request().method() === "POST"
  );
  await begin.press("Enter");
  expect((await retryResponse).status()).toBe(201);

  await expect(
    page.getByRole("heading", { name: "Nothing here yet", exact: true })
  ).toHaveCount(0);
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[0]).not.toBe("");
  expect(mutationIds[1]).toBe(mutationIds[0]);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("dayflow-first-run-seen")
    )
  ).toBe("1");
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
    "Saved."
  );

  const bootstrap = await readBootstrap(page);
  const savedTasks = bootstrap.tasks.filter((task) => task.title === title);
  expect(savedTasks).toHaveLength(1);
  await expect(page.getByLabel("Focus task")).toHaveValue(savedTasks[0].id);
  await expect(
    page.getByRole("button", { name: "Start 25m focus", exact: true })
  ).toBeVisible();
});

test("keeps the workflow and actions usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const onboarding = await openFirstRun(page);
  await onboarding
    .getByLabel("What are you working on right now?")
    .fill("Phone-sized first task");

  const workflow = onboarding.getByLabel("Dayflow workflow");
  await expect(workflow).toContainText("Decide");
  await expect(workflow).toContainText("Plan");
  await expect(workflow).toContainText("Record");
  await expect(workflow).toContainText("Capture");
  await expect(workflow).toContainText("Review");
  await expect(workflow).toContainText("choose next");
  await expectNoHorizontalOverflow(page);

  const actionHeights = await onboarding
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
  expect(actionHeights).toHaveLength(4);
  for (const height of actionHeights) expect(height).toBeGreaterThanOrEqual(44);

  await onboarding
    .getByRole("button", { name: /Capture anything/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Search or add" })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
