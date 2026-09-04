import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(() => {
  resetTestDatabase();
});

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /(tasks? left|Nothing scheduled yet|All done for today)$/
    })
  ).toBeVisible({ timeout: 30_000 });
}

async function createTask(page: Page, title: string, projectId: string | null) {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId, date: null, urgentScore: 2, importanceScore: 2 }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

async function seedBacklog(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { name: "Zebra project" }
  });
  expect(response.status()).toBe(201);
  const project = (await response.json()) as { id: string };
  await createTask(page, "Project backlog task", project.id);
  await createTask(page, "Standalone backlog task", null);
}

async function openBacklog(page: Page) {
  await page.getByRole("button", { name: /^Backlog/ }).click();
  await expect(
    page.getByRole("heading", { name: "Backlog", exact: true })
  ).toBeVisible();
}

async function openProjectBacklog(page: Page) {
  await page.getByRole("button", { name: /^Projects/ }).click();
  await page.getByRole("radio", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Open Zebra project overview" }).click();
  await expect(
    page.getByRole("heading", { name: "Zebra project", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Backlog 1 Unscheduled tasks/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Backlog", exact: true })
  ).toBeVisible();
}

for (const arrangement of ["Quadrant", "Project", "Due", "Figure"]) {
  test(`Backlog keeps ${arrangement} and its project scope across destination navigation`, async ({
    page
  }) => {
    await seedBacklog(page);
    await openDashboard(page);
    await openProjectBacklog(page);
    const selected = page.getByRole("radio", { name: arrangement, exact: true });
    await selected.click();
    await expect(selected).toBeChecked();

    await page.getByRole("button", { name: /^Today/ }).click();
    await expect(page.locator(".backlog-page")).toHaveCount(0);
    await openBacklog(page);

    await expect(selected).toBeChecked();
    await expect(page.locator(".backlog-scope-bar")).toContainText("Zebra project first");
    await expect(page.locator(".matrix-persistent-task")).toHaveCount(2);
    await expect(page.locator(".matrix-stage")).toHaveClass(
      arrangement === "Figure" ? /matrix-layout-figure/ : /matrix-layout-tables/
    );
  });
}

test("the Projects handoff puts that project first without filtering other Backlog tasks", async ({
  page
}) => {
  await seedBacklog(page);
  await openDashboard(page);
  await openProjectBacklog(page);

  await expect(page.getByRole("radio", { name: "Project", exact: true })).toBeChecked();
  await expect(page.locator(".backlog-scope-bar")).toContainText(
    "All backlog tasks are visible · Zebra project first"
  );
  const headings = page.locator(".matrix-table-heading strong");
  await expect(headings).toHaveText(["Zebra project", "Standalone"]);
  await expect(page.getByRole("button", { name: /Project backlog task, Zebra project/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Standalone backlog task, Standalone/ })).toBeVisible();

  await page.getByRole("button", { name: "Back to project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Zebra project", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Backlog 1 Unscheduled tasks/ }).click();
  await page.getByRole("button", { name: "Restore project order", exact: true }).click();
  await expect(page.locator(".backlog-scope-bar")).toHaveCount(0);
  await expect(headings).toHaveText(["Standalone", "Zebra project"]);
});

test("a narrow viewport commits Figure's Quadrant fallback even while Backlog is unmounted", async ({
  page
}) => {
  await seedBacklog(page);
  await openDashboard(page);
  await openProjectBacklog(page);
  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await expect(page.locator(".matrix-stage")).toHaveClass(/matrix-layout-figure/);

  await page.setViewportSize({ width: 699, height: 1000 });
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();
  await expect(page.locator(".matrix-stage")).toHaveClass(/matrix-layout-tables/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("radio", { name: "Figure", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();

  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await page.getByRole("button", { name: /^Today/ }).click();
  await page.setViewportSize({ width: 699, height: 1000 });
  await expect(page.locator("html")).toHaveAttribute("data-figure-arrangement", "false");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBacklog(page);
  await expect(page.getByRole("radio", { name: "Quadrant", exact: true })).toBeChecked();
  await expect(page.locator(".backlog-scope-bar")).toContainText("Zebra project first");
});

// The existing Figure is a deadline/importance plot with selectable dots. It
// has no drag-to-edit handler; extraction must not introduce score mutations.
test("dragging a Figure dot leaves its scores unchanged, including after reload", async ({
  page
}) => {
  const task = await createTask(page, "Figure score check", null);
  await openDashboard(page);
  await openBacklog(page);
  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  const dot = page.getByRole("button", { name: /Figure score check, Standalone/ });
  await expect(page.locator(".matrix-stage")).toHaveClass(/matrix-layout-figure.*matrix-phase-open/);
  await dot.click();
  await expect(page.locator(".matrix-selection-caption strong")).toHaveText("Figure score check");
  const originalPosition = await dot.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top
  }));
  const stage = await page.locator(".matrix-stage").boundingBox();
  expect(stage).not.toBeNull();
  await dot.hover();
  await page.mouse.down();
  await page.mouse.move(stage!.x + 450, stage!.y + 35, { steps: 12 });
  await page.mouse.up();

  async function expectOriginalScores() {
    const response = await page.request.get("/api/bootstrap");
    expect(response.ok()).toBe(true);
    const bootstrap = (await response.json()) as {
      tasks: Array<{ id: string; urgentScore: number; importanceScore: number }>;
    };
    expect(bootstrap.tasks.find(({ id }) => id === task.id)).toEqual(
      expect.objectContaining({ urgentScore: 2, importanceScore: 2 })
    );
  }

  await expectOriginalScores();
  await expect(dot).toHaveCSS("left", originalPosition.left);
  await expect(dot).toHaveCSS("top", originalPosition.top);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: /(tasks? left|Nothing scheduled yet|All done for today)$/
    })
  ).toBeVisible({ timeout: 30_000 });
  await openBacklog(page);
  await page.getByRole("radio", { name: "Figure", exact: true }).click();
  await expect(page.locator(".matrix-stage")).toHaveClass(/matrix-layout-figure.*matrix-phase-open/);
  await expectOriginalScores();
  await expect(dot).toHaveCSS("left", originalPosition.left);
  await expect(dot).toHaveCSS("top", originalPosition.top);
});
