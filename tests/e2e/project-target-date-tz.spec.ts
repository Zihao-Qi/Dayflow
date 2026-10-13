import { expect, test } from "@playwright/test";
import { resetTestDatabase } from "./database";

// Keep browser timezone aligned with the test runner and webServer process
test.use({
  timezoneId: process.env.TZ || undefined
});

test.beforeEach(() => {
  resetTestDatabase();
});

test("preserves project targetDate across unrelated edits and repeated saves in positive UTC offset", async ({
  page
}) => {
  // 1. Seed project with targetDate 2026-10-20
  const response = await page.request.post("/api/projects", {
    data: {
      name: "TZ Target Date Project",
      desiredOutcome: "Initial outcome",
      targetDate: "2026-10-20"
    }
  });
  expect(response.status()).toBe(201);
  const project = (await response.json()) as { id: string };

  // 2. Open project detail overview in the UI
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /^Projects/ }).click();
  await page.getByRole("radio", { name: "List", exact: true }).click();
  const row = page.locator(".project-row").filter({ hasText: "TZ Target Date Project" });
  await row.getByRole("button", { name: "Open TZ Target Date Project overview", exact: true }).click();

  // 3. Confirm overview shows Target Oct 20
  await expect(page.getByText("Target Oct 20")).toBeVisible();

  // 4. Open ProjectEditForm
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit TZ Target Date Project" });
  await expect(dialog).toBeVisible();

  // 5. Verify the date input value matches the local calendar date
  const targetDateInput = dialog.locator('input[type="date"]');
  await expect(targetDateInput).toHaveValue("2026-10-20");

  // 6. Edit an unrelated field (desired outcome) without touching the date
  const outcomeInput = dialog.getByRole("textbox", { name: "Desired outcome" });
  await outcomeInput.fill("Updated outcome via browser edit without touching date");

  // 7. Save changes
  const saveBtn = dialog.getByRole("button", { name: "Save changes", exact: true });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(dialog).toBeHidden();

  // 8. Confirm overview STILL shows Target Oct 20 (not Oct 19)
  await expect(page.getByText("Target Oct 20")).toBeVisible();

  // 9. Reopen edit dialog and perform a second unrelated edit to verify no repeated drift
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(targetDateInput).toHaveValue("2026-10-20");

  await outcomeInput.fill("Second edit without touching date");
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Target Oct 20")).toBeVisible();

  // 10. Confirm persisted API value preserves day 20 in server's local timezone
  const verifyResponse = await page.request.get(`/api/projects/${project.id}`);
  expect(verifyResponse.status()).toBe(200);
  const detail = (await verifyResponse.json()) as { targetDate: string };
  const serverDate = new Date(detail.targetDate);
  expect(serverDate.getDate()).toBe(20);
});
