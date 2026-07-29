import { expect, test, type Page } from "@playwright/test";
import {
  addLocalDays,
  localDateKey,
  localTime
} from "./activity-date-helpers";
import { resetTestDatabase } from "./database";

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

async function openActivityCapture(page: Page) {
  await page.getByRole("button", { name: /Search or add/ }).click();
  await page.getByRole("option", { name: /Log an activity by hand/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Log activity",
    exact: true
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("captures retrospective evidence with a custom category and complete suggestions", async ({
  page
}) => {
  const bootstrap = await page.request.get("/api/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  const { todayKey } = (await bootstrap.json()) as { todayKey: string };
  const historicalDate = addLocalDays(todayKey, -30);
  const selectedDate = addLocalDays(todayKey, -2);
  const futureDate = addLocalDays(todayKey, 1);

  const historical = await page.request.post("/api/activities", {
    data: {
      date: historicalDate,
      startTime: "07:30",
      durationMinutes: 20,
      category: "Research synthesis",
      note: "Category suggestion from complete history"
    }
  });
  expect(historical.status()).toBe(201);

  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Retrospective evidence" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Link retrospective evidence",
      date: todayKey,
      projectId: project.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };

  await openDashboard(page);
  let dialog = await openActivityCapture(page);
  const date = dialog.getByLabel("Activity date", { exact: true });
  await expect(date).toHaveValue(todayKey);
  await expect(date).toHaveAttribute("max", todayKey);

  const suggestions = await dialog
    .locator("#activity-category-suggestions option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
  expect(suggestions.slice(0, 5)).toEqual([
    "Deep Work",
    "Learning",
    "Admin",
    "Health",
    "Rest"
  ]);
  expect(suggestions).toContain("Research synthesis");

  await dialog
    .getByLabel("Activity note")
    .fill("Reconstructed the decision trail");
  await dialog.getByLabel("Time", { exact: true }).fill("08:15");
  await dialog.getByLabel("Minutes", { exact: true }).fill("40");
  await dialog
    .getByLabel("Category", { exact: true })
    .fill("  Strategic Writing  ");
  await dialog
    .getByLabel("Linked task")
    .selectOption({ label: "Link retrospective evidence" });

  await date.fill(futureDate);
  await dialog.getByRole("button", { name: "Add activity" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose today or an earlier Activity date."
  );
  await expect(dialog.getByLabel("Activity note")).toHaveValue(
    "Reconstructed the decision trail"
  );
  await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue(
    "  Strategic Writing  "
  );

  await date.fill(selectedDate);
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/activities" &&
      response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Add activity" }).click();
  const response = await createResponse;
  expect(response.status()).toBe(201);
  const activity = (await response.json()) as {
    startedAt: string;
    durationMinutes: number;
    category: string;
    note: string;
    taskId: string | null;
    projectId: string | null;
    attributedProjectId: string | null;
    origin: string;
    focusSessionId: string | null;
  };
  expect(localDateKey(activity.startedAt)).toBe(selectedDate);
  expect(localTime(activity.startedAt)).toBe("08:15");
  expect(activity).toEqual(
    expect.objectContaining({
      durationMinutes: 40,
      category: "Strategic Writing",
      note: "Reconstructed the decision trail",
      taskId: task.id,
      projectId: null,
      attributedProjectId: project.id,
      origin: "MANUAL",
      focusSessionId: null
    })
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".sr-only[role='status']")).toContainText(
    "Activity saved for"
  );

  dialog = await openActivityCapture(page);
  const refreshedSuggestions = await dialog
    .locator("#activity-category-suggestions option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
  expect(refreshedSuggestions).toContain("Strategic Writing");
});

test("retains the complete capture draft after mismatched and rejected responses on phone", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bootstrap = await page.request.get("/api/bootstrap");
  const { todayKey } = (await bootstrap.json()) as { todayKey: string };
  const selectedDate = addLocalDays(todayKey, -5);
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "Phone capture" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Retain every field",
      date: todayKey,
      projectId: project.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };

  await openDashboard(page);
  const dialog = await openActivityCapture(page);
  await dialog.getByLabel("Activity date").fill(selectedDate);
  await dialog.getByLabel("Time", { exact: true }).fill("18:40");
  await dialog.getByLabel("Minutes", { exact: true }).fill("55");
  await dialog.getByLabel("Category", { exact: true }).fill("Community");
  await dialog
    .getByLabel("Activity note")
    .fill("Kept the full phone draft");
  await dialog
    .getByLabel("Linked task")
    .selectOption({ label: "Retain every field" });

  let attempts = 0;
  await page.route("**/api/activities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      const upstream = await route.fetch();
      const activity = (await upstream.json()) as Record<string, unknown>;
      await route.fulfill({
        response: upstream,
        contentType: "application/json",
        body: JSON.stringify({
          ...activity,
          attributedProjectId: null
        })
      });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Activity service unavailable." })
    });
  });
  await dialog.getByRole("button", { name: "Add activity" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "Activity could not be saved. Your draft is still here."
  );
  await expect(dialog.getByLabel("Activity date")).toHaveValue(selectedDate);
  await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("18:40");
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("55");
  await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue(
    "Community"
  );
  await expect(dialog.getByLabel("Activity note")).toHaveValue(
    "Kept the full phone draft"
  );
  await expect(dialog.getByLabel("Linked task")).toHaveValue(task.id);
  await expect(dialog.getByLabel("Project")).toHaveValue(project.id);

  await dialog.getByRole("button", { name: "Add activity" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Activity service unavailable."
  );
  await expect(dialog.getByLabel("Activity date")).toHaveValue(selectedDate);
  await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("18:40");
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("55");
  await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue(
    "Community"
  );
  await expect(dialog.getByLabel("Activity note")).toHaveValue(
    "Kept the full phone draft"
  );
  await expect(dialog.getByLabel("Linked task")).toHaveValue(task.id);
  await expect(dialog.getByLabel("Project")).toHaveValue(project.id);

  const dimensions = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1
  );
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1
  );
  for (const control of [
    dialog.getByLabel("Activity date"),
    dialog.getByLabel("Category", { exact: true }),
    dialog.getByRole("button", { name: "Add activity" })
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
