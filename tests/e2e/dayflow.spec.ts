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
  await reloadedRail.getByRole("button", { name: "Finish", exact: true }).click();

  await expect(reloadedRail.getByRole("heading", { name: "2m counted" })).toBeVisible();
  await reloadedRail
    .getByPlaceholder("Add a note if it will help you remember this block.")
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
  expect(stale.status()).toBe(400);
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
  await rail.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(rail.getByRole("heading", { name: "3m counted" })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "Finish without details" })
  ).toBeEnabled();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("3m focused this week", { exact: true })).toBeVisible();
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
  expect(controlStyle.activeFontSize).toBe("11.5px");
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
  const reflection = page.getByPlaceholder(
    "What worked, and what deserves protection next week?"
  );
  await reflection.fill("Protect the quiet feedback loop.");
  await reflection.press("Meta+Enter");
  await expect(
    page.locator(".reflection-heading").getByText("Saved", { exact: true })
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
