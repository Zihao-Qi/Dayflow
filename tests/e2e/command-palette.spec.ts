import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /(tasks? left|Nothing scheduled yet|All done for today)$/ })).toBeVisible({
    timeout: 30_000
  });
}

function commandPalette(page: Page) {
  return page.getByRole("dialog", {
    name: "Search or add",
    exact: true
  });
}

function commandInput(page: Page) {
  return commandPalette(page).getByRole("combobox", {
    name: "Search commands and tasks",
    exact: true
  });
}

async function openPaletteWithShortcut(page: Page) {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+K`);
  await expect(commandPalette(page)).toBeVisible();
  await expect(commandInput(page)).toBeFocused();
}

for (const modifier of ["Meta", "Control"]) {
  test(`${modifier}+K opens the palette and Escape restores its opener`, async ({ page }) => {
    await openDashboard(page);
    const opener = page.getByRole("button", { name: /Search or add/ });
    await opener.focus();
    await page.keyboard.press(`${modifier}+K`);
    await expect(commandPalette(page)).toBeVisible();
    await expect(commandInput(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(commandPalette(page)).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test(`${modifier}+Shift+F prefills and expands Focus outside Today`, async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    const rail = page.getByRole("complementary", { name: "Focus rail" });
    await expect(rail).toHaveCount(0);
    await page.keyboard.press(`${modifier}+Shift+F`);
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button", { name: "25 minutes, 5 minute break", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByRole("button", { name: "Start 25m focus", exact: true })).toBeEnabled();
    // A second shortcut must replace a changed draft, not just reveal the rail.
    await rail.getByRole("button", { name: "50 minutes, 10 minute break", exact: true }).click();
    await page.keyboard.press(`${modifier}+Shift+F`);
    await expect(rail.getByRole("button", { name: "25 minutes, 5 minute break", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rail.getByRole("button", { name: "Start 25m focus", exact: true })).toBeEnabled();
  });
}

test("does not stack over an existing modal dialog", async ({ page }) => {
  await openDashboard(page);

  await page
    .getByRole("button", { name: "Data & backups", exact: true })
    .click();
  const dataDialog = page.getByRole("dialog", {
    name: "Data & backups",
    exact: true
  });
  await expect(dataDialog).toBeVisible();

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+K`);

  await expect(commandPalette(page)).toHaveCount(0);
  await expect(dataDialog).toBeVisible();
  await expect(
    dataDialog.getByRole("button", {
      name: "Close data and backups",
      exact: true
    })
  ).toBeFocused();
});

test("hands a plain phrase to the new Task form without saving it", async ({
  page
}) => {
  await openDashboard(page);
  await openPaletteWithShortcut(page);

  const title = "Prepare the project handoff";
  await commandInput(page).fill(title);
  await page.keyboard.press("Enter");

  const taskInput = page.getByPlaceholder("Add a task for today");
  await expect(commandPalette(page)).toHaveCount(0);
  await expect(taskInput).toBeFocused();
  await expect(taskInput).toHaveValue(title);
  await expect(
    page.getByRole("article", { name: `Task: ${title}`, exact: true })
  ).toHaveCount(0);
});

test("hands a valid URL to the Journal reference form", async ({ page }) => {
  await openDashboard(page);
  await openPaletteWithShortcut(page);

  const url = "https://example.com/palette-reference";
  await commandInput(page).fill(url);
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Save reference", exact: true })
  ).toBeVisible();
  const urlInput = page.getByPlaceholder("URL");
  await expect(urlInput).toBeFocused();
  await expect(urlInput).toHaveValue(url);
});

test("opens a custom 37 minute Focus Session from a focus query", async ({
  page
}) => {
  await openDashboard(page);
  await openPaletteWithShortcut(page);

  await commandInput(page).fill("focus 37");
  await page.keyboard.press("Enter");

  const focusRail = page.getByRole("complementary", {
    name: "Focus rail",
    exact: true
  });
  await expect(commandPalette(page)).toHaveCount(0);
  await expect(
    focusRail.getByRole("button", {
      name: "Custom focus duration",
      exact: true
    })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(focusRail.getByLabel("Custom focus minutes")).toHaveValue("37");
  await expect(
    focusRail.getByRole("button", {
      name: "Start 37m focus",
      exact: true
    })
  ).toBeVisible();
});

test("keeps an invalid focus duration honest and out of the Task form", async ({
  page
}) => {
  await openDashboard(page);
  await openPaletteWithShortcut(page);

  await commandInput(page).fill("focus 241");
  await page.keyboard.press("Enter");

  const palette = commandPalette(page);
  await expect(palette).toBeVisible();
  await expect(palette.getByText(/focus.+1.+240/i)).toBeVisible();
  await expect(commandInput(page)).toHaveValue("focus 241");
  await expect(page.getByPlaceholder("Add a task for today")).toHaveValue("");
  await expect(
    page.getByRole("article", { name: "Task: focus 241", exact: true })
  ).toHaveCount(0);
});

test("wraps Arrow selection, activates with Enter, and restores focus on Escape", async ({
  page
}) => {
  await openDashboard(page);

  const opener = page.getByRole("button", { name: /Search or add/ }).first();
  await opener.focus();
  await opener.click();
  await expect(commandInput(page)).toBeFocused();

  const options = commandPalette(page).getByRole("option");
  await expect(options).toHaveCount(5);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.last()).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "false");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.last()).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByPlaceholder("Add a task for today")).toBeFocused();

  await opener.click();
  await expect(commandInput(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(commandPalette(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("searches a far-future unfinished Task and prepares it for Focus", async ({
  page
}) => {
  const title = "Prepare the 2099 archive map";
  const createTask = await page.request.post("/api/tasks", {
    data: {
      title,
      date: "2099-12-31",
      estimateMinutes: 47
    }
  });
  expect(createTask.status()).toBe(201);
  const task = (await createTask.json()) as { id: string };

  await openDashboard(page);
  await openPaletteWithShortcut(page);
  await commandInput(page).fill(title);

  const taskOption = commandPalette(page).getByRole("option", {
    name: `${title} Focus on Unfinished Task`,
    exact: true
  });
  await expect(taskOption).toBeVisible();
  await expect(taskOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  const focusRail = page.getByRole("complementary", {
    name: "Focus rail",
    exact: true
  });
  await expect(commandPalette(page)).toHaveCount(0);
  const focusTask = focusRail.getByLabel("Focus task");
  await expect(focusTask).toHaveValue(task.id);
  await expect(focusTask.locator("option:checked")).toHaveText(title);
  await expect(
    focusRail.getByRole("button", {
      name: "Start 47m focus",
      exact: true
    })
  ).toBeVisible();
});

test("prepares a custom Focus Session without starting it on a phone", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  await page
    .getByRole("button", { name: "Search or add", exact: true })
    .click();
  await commandInput(page).fill("focus 19");
  await page.keyboard.press("Enter");

  const focusRail = page.getByRole("complementary", {
    name: "Focus rail",
    exact: true
  });
  await expect(commandPalette(page)).toHaveCount(0);
  await expect(focusRail).toBeVisible();
  await expect(
    focusRail.getByRole("button", {
      name: "Custom focus duration",
      exact: true
    })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(focusRail.getByLabel("Custom focus minutes")).toHaveValue("19");
  await expect(
    focusRail.getByRole("button", {
      name: "Start 19m focus",
      exact: true
    })
  ).toBeVisible();
});

test("keeps an unsaved Task draft when choosing the empty Task action", async ({
  page
}) => {
  await openDashboard(page);

  const taskInput = page.getByPlaceholder("Add a task for today");
  const draft = "Keep this unsaved Task draft";
  await taskInput.fill(draft);

  await openPaletteWithShortcut(page);
  await commandPalette(page)
    .getByRole("option", { name: "New Task for today", exact: true })
    .click();

  await expect(commandPalette(page)).toHaveCount(0);
  await expect(taskInput).toBeFocused();
  await expect(taskInput).toHaveValue(draft);
});

test("keeps an unsaved Note draft when choosing the empty Note action", async ({
  page
}) => {
  await openDashboard(page);

  await openPaletteWithShortcut(page);
  await commandPalette(page)
    .getByRole("option", { name: "Write a note", exact: true })
    .click();
  const noteInput = page.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  const draft = "Keep this unsaved Note draft";
  await noteInput.fill(draft);

  await openPaletteWithShortcut(page);
  await commandPalette(page)
    .getByRole("option", { name: "Write a note", exact: true })
    .click();

  await expect(commandPalette(page)).toHaveCount(0);
  await expect(noteInput).toBeFocused();
  await expect(noteInput).toHaveValue(draft);
});

test("keeps an unsaved Reference draft when choosing the empty Reference action", async ({
  page
}) => {
  await openDashboard(page);

  await openPaletteWithShortcut(page);
  await commandPalette(page)
    .getByRole("option", { name: "Save a reference", exact: true })
    .click();
  const urlInput = page.getByPlaceholder("URL");
  const draft = "https://example.com/unsaved-reference";
  await urlInput.fill(draft);

  await openPaletteWithShortcut(page);
  await commandPalette(page)
    .getByRole("option", { name: "Save a reference", exact: true })
    .click();

  await expect(commandPalette(page)).toHaveCount(0);
  await expect(urlInput).toBeFocused();
  await expect(urlInput).toHaveValue(draft);
});

test("hands an explicit Note to the Journal from the mobile palette", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  await page
    .getByRole("button", { name: "Search or add", exact: true })
    .click();
  await expect(commandInput(page)).toBeFocused();

  const content = "Keep mobile capture intentional";
  await commandInput(page).fill(`note ${content}`);
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
  const noteInput = page.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  await expect(noteInput).toBeFocused();
  await expect(noteInput).toHaveValue(content);
});
