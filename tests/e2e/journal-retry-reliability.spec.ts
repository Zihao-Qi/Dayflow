import { expect, test, type Page } from "@playwright/test";
import { addLocalDays, localDateKey } from "./activity-date-helpers";
import { resetTestDatabase } from "./database";

test.beforeEach(() => resetTestDatabase());

async function openNotes(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("dayflow-first-run-seen", "1"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  return page.locator(".capture-form").filter({ hasText: "New note" });
}

async function exportedNotes(page: Page) {
  const response = await page.request.get("/api/agent-export");
  expect(response.ok()).toBe(true);
  return (await response.json()).notes as Array<{ id: string; content: string; date: string; taskId: string | null; projectId: string | null }>;
}

// Only the browser calendar is shifted. For the no-commit case the initial
// browser day is yesterday, so the real first server commit occurs on the new
// day. For the lost-success case the server commits on the initial browser day.
async function calendarRollover(page: Page, initialDay: string) {
  let nextDay = false;
  let publishedDay = "";
  await page.clock.install({ time: new Date(`${initialDay}T23:55:00`) });
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const key = nextDay ? addLocalDays(initialDay, 1) : initialDay;
    payload.todayKey = key;
    payload.today = new Date(`${key}T00:00:00`).toISOString();
    await route.fulfill({ response, json: payload });
    publishedDay = key;
  });
  return async () => {
    nextDay = true;
    await page.clock.pauseAt(new Date(`${initialDay}T23:59:59`));
    await page.clock.runFor(1_500);
    await expect.poll(() => publishedDay).toBe(addLocalDays(initialDay, 1));
    // Reading a stable UI option below also verifies consumption, not just transport.
  };
}

for (const firstAttempt of ["committed response lost", "never reached server"] as const) {
  test(`acknowledges unchanged Note intent across midnight when the first attempt ${firstAttempt}`, async ({ page }) => {
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    const initialDay = firstAttempt === "committed response lost"
      ? bootstrap.todayKey : addLocalDays(bootstrap.todayKey, -1);
    const projectResponse = await page.request.post("/api/projects", { data: { name: "Retry attribution" } });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json();
    const taskResponse = await page.request.post("/api/tasks", { data: { title: "Task changes between attempts", date: null } });
    expect(taskResponse.status()).toBe(201);
    const task = await taskResponse.json();
    const rollover = await calendarRollover(page, initialDay);
    const form = await openNotes(page);
    const content = form.getByPlaceholder("Capture a thought, decision, or reminder.");
    const note = `Unchanged Note: ${firstAttempt}`;
    await content.fill(note);
    await form.getByPlaceholder("Tags, comma separated").fill("retry, midnight");
    await form.getByLabel("Note linked task").selectOption(task.id);
    await form.getByLabel("Project", { exact: true }).selectOption(project.id);

    const attempts: Array<{ id: string; body: Record<string, unknown> }> = [];
    const savedFirst: { committed?: { id: string } } = {};
    await page.route("**/api/notes", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push({ id: route.request().headers()["x-dayflow-mutation-id"], body: route.request().postDataJSON() });
      if (attempts.length !== 1) return route.continue();
      if (firstAttempt === "committed response lost") {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        savedFirst.committed = await response.json();
      }
      await route.abort("failed");
    });
    await form.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.locator(".app-error-toast")).toContainText("The note could not be saved. Your draft is still here.");
    await expect(form.getByRole("button", { name: "Save note", exact: true })).toBeEnabled();
    const before = await exportedNotes(page);
    expect(before).toHaveLength(firstAttempt === "committed response lost" ? 1 : 0);
    if (firstAttempt === "committed response lost") {
      expect(before[0].projectId).toBe(project.id);
      expect(localDateKey(before[0].date)).toBe(initialDay);
    }
    // Settle the real intervening write before publishing the next bootstrap.
    const assigned = await page.request.patch(`/api/tasks/${task.id}`, { data: { projectId: project.id, phaseId: null } });
    expect(assigned.ok()).toBe(true);
    expect((await assigned.json()).projectId).toBe(project.id);
    await rollover();
    await expect(form.getByLabel("Project", { exact: true })).toBeDisabled();
    await expect(form.getByLabel("Project", { exact: true })).toHaveValue(project.id);
    await expect(content).toHaveValue(note);

    const retried = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/notes" && response.request().method() === "POST");
    await form.getByRole("button", { name: "Save note", exact: true }).click();
    const response = await retried;
    expect(response.status()).toBe(201);
    const receipt = await response.json();
    expect(localDateKey(receipt.date)).toBe(initialDay);
    expect(receipt.projectId).toBe(firstAttempt === "committed response lost" ? project.id : null);
    if (savedFirst.committed) expect(receipt.id).toBe(savedFirst.committed.id);
    // The real canonical receipt must be acknowledged by the mounted capture owner.
    await expect(content).toHaveValue("");
    expect(attempts).toHaveLength(2);
    expect(attempts[0].id).toBeTruthy();
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0].body.date).toBe(initialDay);
    const after = await exportedNotes(page);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(receipt.id);
    expect(localDateKey(after[0].date)).toBe(initialDay);

    // A genuinely new next-day capture gets its own explicit day and ID.
    await content.fill("Ordinary next-day Note");
    const newSaved = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/notes" && candidate.request().method() === "POST");
    await form.getByRole("button", { name: "Save note", exact: true }).click();
    expect((await newSaved).status()).toBe(201);
    await expect(content).toHaveValue("");
    expect(attempts[2].id).not.toBe(attempts[0].id);
    expect(attempts[2].body.date).toBe(addLocalDays(initialDay, 1));
    expect(await exportedNotes(page)).toHaveLength(2);
  });
}
