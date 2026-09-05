import { expect, test, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedJournalSearchHistory
} from "./database";

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

function commandPalette(page: Page) {
  return page.getByRole("dialog", { name: "Search or add", exact: true });
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

async function openJournal(page: Page) {
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
}

async function leaveAndReturnToJournal(page: Page) {
  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toHaveCount(0);
  await openJournal(page);
}

test("Journal keeps its loaded history, filters, and unsaved drafts across destination navigation", async ({
  page
}) => {
  seedJournalSearchHistory();
  await openDashboard(page);
  await openJournal(page);
  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(page.getByRole("radio", { name: "Notes · 125" })).toBeVisible();

  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  const noteContent = noteForm.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  const noteTags = noteForm.getByPlaceholder("Tags, comma separated");
  await noteContent.fill("An unsaved note that must survive navigation");
  await noteTags.fill("survives-navigation");

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 100 of 125 notes")).toBeVisible();
  await expect(page.getByText("Needle note 026", { exact: true })).toBeVisible();

  await leaveAndReturnToJournal(page);

  await expect(page.getByRole("radio", { name: "Notes · 125" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(page.getByText("Showing 100 of 125 notes")).toBeVisible();
  await expect(page.getByText("Needle note 026", { exact: true })).toBeVisible();
  await expect(noteContent).toHaveValue(
    "An unsaved note that must survive navigation"
  );
  await expect(noteTags).toHaveValue("survives-navigation");

  const search = page.getByRole("search", { name: "Search Notes" });
  await search.getByLabel("Search Notes").fill("needle");
  await search.getByLabel("Filter by tag").fill("design-systems");
  await expect(page.getByRole("radio", { name: "Notes · 63" })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByText("All 63 notes loaded.", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();

  await leaveAndReturnToJournal(page);

  await expect(search.getByLabel("Search Notes")).toHaveValue("needle");
  await expect(search.getByLabel("Filter by tag")).toHaveValue(
    "design-systems"
  );
  await expect(page.getByRole("radio", { name: "Notes · 63" })).toBeVisible();
  await expect(
    page.getByText("All 63 notes loaded.", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();
  await expect(noteContent).toHaveValue(
    "An unsaved note that must survive navigation"
  );

  await page.getByRole("radio", { name: /References/ }).click();
  await expect(
    page.getByRole("radio", { name: "References · 125" })
  ).toBeVisible();
  const referenceForm = page
    .locator(".capture-form")
    .filter({ hasText: "Save reference" });
  await referenceForm.getByPlaceholder("Title").fill("Unsaved reference title");
  await referenceForm
    .getByPlaceholder("URL")
    .fill("https://example.com/survives-navigation");
  await referenceForm
    .getByPlaceholder("Why this matters")
    .fill("The draft outlives the destination.");
  const referenceSearch = page.getByRole("search", {
    name: "Search References"
  });
  await referenceSearch.getByLabel("Search References").fill("beacon");
  await expect(
    page.getByRole("radio", { name: "References · 125" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 100 of 125 references")).toBeVisible();

  const linkedNote = referenceForm.getByLabel("Reference linked note");
  await expect(linkedNote.locator("option")).toHaveCount(51);
  await referenceForm.getByRole("button", { name: "Load older notes" }).click();
  await expect(linkedNote.locator("option")).toHaveCount(101);

  await leaveAndReturnToJournal(page);

  await expect(
    page.getByRole("radio", { name: "References · 125" })
  ).toHaveAttribute("aria-checked", "true");
  await expect(referenceSearch.getByLabel("Search References")).toHaveValue(
    "beacon"
  );
  await expect(page.getByText("Showing 100 of 125 references")).toBeVisible();
  await expect(linkedNote.locator("option")).toHaveCount(101);
  await expect(referenceForm.getByPlaceholder("Title")).toHaveValue(
    "Unsaved reference title"
  );
  await expect(referenceForm.getByPlaceholder("URL")).toHaveValue(
    "https://example.com/survives-navigation"
  );
  await expect(
    referenceForm.getByPlaceholder("Why this matters")
  ).toHaveValue("The draft outlives the destination.");

  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(search.getByLabel("Search Notes")).toHaveValue("needle");
  await expect(search.getByLabel("Filter by tag")).toHaveValue(
    "design-systems"
  );
  await expect(noteContent).toHaveValue(
    "An unsaved note that must survive navigation"
  );
});

test("the command palette hands a draft to the Journal without discarding the rest of it", async ({
  page
}) => {
  const taskResponse = await page.request.post("/api/tasks", {
    data: { title: "Palette linked task", date: null, projectId: null }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };

  await openDashboard(page);
  await openPaletteWithShortcut(page);
  await commandInput(page).fill("note Original palette capture");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  const noteContent = noteForm.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  await expect(noteContent).toBeFocused();
  await expect(noteContent).toHaveValue("Original palette capture");

  await noteForm.getByPlaceholder("Tags, comma separated").fill("palette-tags");
  await noteForm.getByLabel("Note linked task").selectOption(task.id);

  await page.getByRole("button", { name: /^Today/ }).click();
  await openPaletteWithShortcut(page);
  await commandInput(page).fill("note Handed over from the palette");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /Notes/ })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(noteContent).toBeFocused();
  await expect(noteContent).toHaveValue("Handed over from the palette");
  await expect(
    noteForm.getByPlaceholder("Tags, comma separated")
  ).toHaveValue("palette-tags");
  await expect(noteForm.getByLabel("Note linked task")).toHaveValue(task.id);

  await page.getByRole("radio", { name: /References/ }).click();
  const referenceForm = page
    .locator(".capture-form")
    .filter({ hasText: "Save reference" });
  await referenceForm.getByPlaceholder("Title").fill("Kept reference title");
  await referenceForm
    .getByPlaceholder("Why this matters")
    .fill("Kept reference reasoning.");
  await referenceForm.getByLabel("Reference linked task").selectOption(task.id);

  await page.getByRole("button", { name: /^Today/ }).click();
  await openPaletteWithShortcut(page);
  await commandInput(page).fill("https://example.com/palette-handoff");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Journal", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /References/ })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  const referenceUrl = referenceForm.getByPlaceholder("URL");
  await expect(referenceUrl).toBeFocused();
  await expect(referenceUrl).toHaveValue(
    "https://example.com/palette-handoff"
  );
  await expect(referenceForm.getByPlaceholder("Title")).toHaveValue(
    "Kept reference title"
  );
  await expect(
    referenceForm.getByPlaceholder("Why this matters")
  ).toHaveValue("Kept reference reasoning.");
  await expect(
    referenceForm.getByLabel("Reference linked task")
  ).toHaveValue(task.id);
});

test("Daily page mood and energy persist, and a rejected save recovers through Retry", async ({
  page
}) => {
  await openDashboard(page);
  await openJournal(page);

  const mood = page.getByLabel("Mood", { exact: true });
  const energy = page.getByLabel("Energy", { exact: true });
  const heading = page.locator(".journal-card-heading");

  const firstSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/diary" &&
      response.request().method() === "PUT"
  );
  await page
    .getByPlaceholder("Write a few lines about the day.")
    .fill("The mood and energy belong with the writing.");
  await mood.fill("4");
  await energy.fill("2");
  await expect(page.getByText("Mood · 4/5")).toBeVisible();
  await expect(page.getByText("Energy · 2/5")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await firstSave).ok()).toBe(true);
  await expect(heading.getByText("Saved", { exact: true })).toBeVisible();

  expect(await diaryFromBootstrap(page)).toEqual(
    expect.objectContaining({
      content: "The mood and energy belong with the writing.",
      mood: 4,
      energy: 2
    })
  );

  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: /(tasks? left|Nothing scheduled yet|All done for today)$/
    })
  ).toBeVisible({ timeout: 30_000 });
  await openJournal(page);
  await expect(page.getByLabel("Mood", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Energy", { exact: true })).toHaveValue("2");

  let rejectSaves = true;
  let attempts = 0;
  await page.route("**/api/diary", async (route) => {
    if (route.request().method() !== "PUT" || !rejectSaves) {
      await route.continue();
      return;
    }
    attempts += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INTERNAL_ERROR",
        error: "The journal could not be saved."
      })
    });
  });

  await page.getByLabel("Mood", { exact: true }).fill("5");
  await page.getByLabel("Energy", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".journal-card-heading .save-state-chip.error")).toContainText(
    "Not saved",
    { timeout: 12_000 }
  );
  expect(attempts).toBeGreaterThanOrEqual(3);
  await expect(
    page.getByText(
      "Couldn’t save the journal. Your writing is still here — retry.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.locator(".sr-only[role='status']")).toHaveText(
    "Journal was not saved."
  );
  await expect(page.getByLabel("Mood", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Energy", { exact: true })).toHaveValue("1");

  rejectSaves = false;
  const recovered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/diary" &&
      response.request().method() === "PUT" &&
      response.ok()
  );
  await page
    .locator(".journal-card-heading .save-state-chip.error")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  expect((await recovered).ok()).toBe(true);
  await expect(page.locator(".sr-only[role='status']")).toHaveText("Saved.");
  await expect(
    page.getByText(
      "Couldn’t save the journal. Your writing is still here — retry.",
      { exact: true }
    )
  ).toHaveCount(0);
  await page.unroute("**/api/diary");

  expect(await diaryFromBootstrap(page)).toEqual(
    expect.objectContaining({
      content: "The mood and energy belong with the writing.",
      mood: 5,
      energy: 1
    })
  );
});

async function diaryFromBootstrap(page: Page) {
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  const bootstrap = (await response.json()) as {
    diary: { content: string; mood: number; energy: number };
  };
  return bootstrap.diary;
}
