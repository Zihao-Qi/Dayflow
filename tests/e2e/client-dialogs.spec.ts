import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase, setFocusSessionElapsedMinutes } from "./database";

test.beforeEach(() => resetTestDatabase());

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start 25m focus" })).toBeEnabled();
}

test("custom focus rejects out-of-range durations and starts at both bounds", async ({ page }) => {
  await openDashboard(page);
  const rail = page.getByRole("complementary", { name: "Focus rail" });
  await rail.getByRole("button", { name: "50 minutes, 10 minute break" }).click();
  await expect(rail.getByRole("button", { name: "Start 50m focus" })).toBeEnabled();
  await rail.getByRole("button", { name: "Custom focus duration" }).click();
  const minutes = rail.getByLabel("Custom focus minutes");
  await expect(minutes).toHaveAttribute("min", "1");
  await expect(minutes).toHaveAttribute("max", "240");
  let starts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/focus-session" && request.method() === "POST") starts += 1;
  });
  for (const value of ["", "0", "241"]) {
    await minutes.fill(value);
    await rail.getByRole("button", { name: /^Start \d+m focus$/ }).click();
    await expect(rail.getByRole("status")).toHaveText("Choose a duration between 1 and 240 minutes.");
    expect(starts).toBe(0);
  }
  for (const value of ["1", "240"]) {
    await minutes.fill(value);
    const started = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/focus-session" && response.request().method() === "POST"
    );
    await rail.getByRole("button", { name: `Start ${value}m focus` }).click();
    const response = await started;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({
      kind: "FOCUS", plannedMinutes: Number(value), taskId: null, projectId: null
    });
    await expect(rail.locator(".rail-focus-clock span")).toHaveText(`Focus · ${value}m`);
    await rail.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(minutes).toHaveValue(value);
  }
  expect(starts).toBe(2);
});

for (const category of ["Learning", "Admin"]) {
  test(`completion preserves ${category} and note through a failed save, then enriches once`, async ({ page }) => {
    const taskResponse = await page.request.post("/api/tasks", {
      data: { title: "Enrich this task", date: null }
    });
    expect(taskResponse.status()).toBe(201);
    const task = await taskResponse.json() as { id: string };
    const startResponse = await page.request.post("/api/focus-session", {
      data: { kind: "FOCUS", plannedMinutes: 25, taskId: task.id, label: "Enrichment" }
    });
    expect(startResponse.status()).toBe(201);
    const { session } = await startResponse.json() as { session: { id: string } };
    setFocusSessionElapsedMinutes(session.id, 3);
    await page.addInitScript(() => window.localStorage.setItem("dayflow-first-run-seen", "1"));
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Focus rail" });
    await rail.getByRole("button", { name: /^Finish( \d+m)?$/ }).click();
    await expect(rail.getByRole("heading", { name: "3m counted" })).toBeVisible();
    const note = `A ${category} detail\nwith a second line`;
    await rail.getByLabel("Completion note").fill(note);
    await rail.getByRole("button", { name: category, exact: true }).click();
    await rail.getByRole("button", { name: "Mark done", exact: true }).click();
    let attempts = 0;
    await page.route(`**/api/focus-session/${session.id}`, async (route) => {
      if (route.request().postDataJSON()?.action === "enrich") {
        attempts += 1;
        expect(route.request().postDataJSON()).toEqual({
          action: "enrich", note, category, taskCompleted: true
        });
        if (attempts === 1) {
          await route.fulfill({ status: 500, json: { error: "The completion record could not be saved." } });
          return;
        }
      }
      await route.continue();
    });
    const save = rail.getByRole("button", { name: "Save details and keep working" });
    await save.click();
    await expect(rail.getByRole("status")).toHaveText("The completion record could not be saved.");
    await expect(rail.getByLabel("Completion note")).toHaveValue(note);
    await expect(rail.getByRole("button", { name: category, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByRole("button", { name: "Mark done", exact: true })).toHaveClass("primary-button");
    await save.click();
    await expect(rail.getByText("Start a focus session", { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
    const bootstrapResponse = await page.request.get("/api/bootstrap");
    expect(bootstrapResponse.ok()).toBe(true);
    const bootstrap = await bootstrapResponse.json() as {
      activities: Array<{ focusSessionId: string | null; note: string; category: string }>;
      tasks: Array<{ id: string; status: string }>;
    };
    expect(bootstrap.activities.filter((activity) => activity.focusSessionId === session.id)).toEqual([
      expect.objectContaining({ note, category, durationMinutes: 3, origin: "FOCUS" })
    ]);
    const snapshotResponse = await page.request.get("/api/focus-session");
    expect(snapshotResponse.ok()).toBe(true);
    expect(await snapshotResponse.json()).toEqual(expect.objectContaining({ active: null, pendingCompletion: null }));
    expect(bootstrap.tasks.find((candidate) => candidate.id === task.id)?.status).toBe("DONE");
  });
}

test("completion alert permission control disappears after permission is granted", async ({ page }) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "default";
        static async requestPermission() {
          requests += 1;
          document.documentElement.dataset.notificationRequests = String(requests);
          this.permission = "granted";
          return "granted";
        }
      }
    });
  });
  await openDashboard(page);
  const permission = page.getByRole("button", { name: "Enable completion alert" });
  await permission.click();
  await expect(permission).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-notification-requests", "1");
});
