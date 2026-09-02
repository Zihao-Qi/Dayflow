import { expect, test } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

test("shows migration recovery instead of loading forever and retries", async ({
  page
}) => {
  let bootstrapRequests = 0;
  await page.route("**/api/bootstrap", async (route) => {
    bootstrapRequests += 1;
    if (bootstrapRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "DATABASE_MIGRATION_REQUIRED",
          error:
            "Dayflow's local database needs an update. Stop Dayflow, run `npm run db:migrate`, then start Dayflow again."
        })
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");

  const recoveryHeading = page.getByRole("heading", {
    name: "Update Dayflow's local database"
  });
  const recovery = page.getByRole("alert").filter({ has: recoveryHeading });
  await expect(
    recovery.getByRole("heading", { name: "Update Dayflow's local database" })
  ).toBeVisible();
  await expect(recovery).toContainText("npm run db:migrate");
  await expect(
    page.getByText("Opening Dayflow", { exact: true })
  ).toHaveCount(0);

  await recovery.getByRole("button", { name: "Try again" }).click();

  await expect(recovery).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Search or add/ })
  ).toBeVisible();
  expect(bootstrapRequests).toBe(2);
});
