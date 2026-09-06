import { expect, type Page } from "@playwright/test";

const destinations = ["today", "day", "projects", "backlog", "journal", "review"] as const;
type Destination = (typeof destinations)[number];

/** Exercise every other mount before returning to the state under test. */
export async function tourDestinationsAndReturn(page: Page, origin: Destination) {
  for (const destination of [...destinations.filter((item) => item !== origin), origin]) {
    const button = page.locator(`.nav-list [data-nav-id="${destination}"]`);
    await button.click();
    await expect(button).toHaveClass("nav-item active");
    if (destination === "today") {
      await expect(page.locator(".today-page")).toBeVisible();
    } else {
      const label = destination === "day"
        ? "Log"
        : destination[0].toUpperCase() + destination.slice(1);
      await expect(page.getByRole("heading", { name: label, exact: true, level: 1 })).toBeVisible();
    }
  }
}
