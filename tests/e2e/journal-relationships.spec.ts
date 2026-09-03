import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedJournalHistory
} from "./database";

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

async function createProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { name }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function createTask(
  page: Page,
  title: string,
  projectId: string | null
) {
  const response = await page.request.post("/api/tasks", {
    data: { title, date: null, projectId }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; title: string };
}

test("captures Task-linked Notes and Task/Note-linked References with canonical attribution", async ({
  page
}) => {
  const project = await createProject(page, "Journal relationships");
  const projectTask = await createTask(
    page,
    "Connect the research trail",
    project.id
  );
  const standaloneTask = await createTask(
    page,
    "Capture the standalone decision",
    null
  );

  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  const noteContent = noteForm.getByPlaceholder(
    "Capture a thought, decision, or reminder."
  );
  await noteContent.fill("The Task owns this decision context.");
  await noteForm
    .getByPlaceholder("Tags, comma separated")
    .fill(" #Decisions, Design systems, decisions ");
  await noteForm
    .getByLabel("Note linked task")
    .selectOption(projectTask.id);
  const noteProject = noteForm.getByLabel("Project", { exact: true });
  await expect(noteProject).toHaveValue(project.id);
  await expect(noteProject).toBeDisabled();
  await expect(noteForm).toContainText("Inherited from linked task");
  await noteForm
    .getByLabel("Note linked task")
    .selectOption(standaloneTask.id);
  await noteProject.selectOption(project.id);

  let noteMismatchInjected = false;
  await page.route("**/api/notes", async (route) => {
    if (route.request().method() !== "POST" || noteMismatchInjected) {
      await route.continue();
      return;
    }
    noteMismatchInjected = true;
    const upstream = await route.fetch();
    const note = (await upstream.json()) as Record<string, unknown>;
    await route.fulfill({
      response: upstream,
      contentType: "application/json",
      body: JSON.stringify({ ...note, taskId: null })
    });
  });
  await noteForm.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText(
    "The note could not be saved. Your draft is still here.",
    { exact: true }
  )).toBeVisible();
  await expect(noteContent).toHaveValue(
    "The Task owns this decision context."
  );
  await expect(
    noteForm.getByPlaceholder("Tags, comma separated")
  ).toHaveValue(" #Decisions, Design systems, decisions ");
  await expect(noteForm.getByLabel("Note linked task")).toHaveValue(
    standaloneTask.id
  );
  await expect(noteProject).toHaveValue(project.id);
  await page.unroute("**/api/notes");

  const noteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/notes" &&
      response.request().method() === "POST"
  );
  await noteForm.getByRole("button", { name: "Save note" }).click();
  const savedNote = (await (await noteResponse).json()) as {
    id: string;
    content: string;
    tags: string[];
    taskId: string | null;
    projectId: string | null;
  };
  expect(savedNote).toEqual(
    expect.objectContaining({
      content: "The Task owns this decision context.",
      tags: ["decisions", "design-systems"],
      taskId: standaloneTask.id,
      projectId: project.id
    })
  );
  await expect(noteContent).toHaveValue("");
  const noteCard = page
    .locator(".note-card")
    .filter({ hasText: "The Task owns this decision context." });
  await expect(noteCard).toContainText("Task: Capture the standalone decision");
  await expect(noteCard).toContainText("Journal relationships");

  await page.getByRole("radio", { name: /References/ }).click();
  const referenceForm = page
    .locator(".capture-form")
    .filter({ hasText: "Save reference" });
  await referenceForm
    .getByPlaceholder("URL")
    .fill("https://www.youtube.com/watch?v=journal");
  await referenceForm
    .getByPlaceholder("Why this matters")
    .fill("Supports the linked decision.");
  await referenceForm
    .getByLabel("Reference linked task")
    .selectOption(projectTask.id);
  await referenceForm
    .getByLabel("Reference linked note")
    .selectOption(savedNote.id);
  await expect(referenceForm.getByLabel("Project", { exact: true })).toHaveValue(
    project.id
  );
  await expect(
    referenceForm.getByLabel("Project", { exact: true })
  ).toBeDisabled();

  const materialResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/materials" &&
      response.request().method() === "POST"
  );
  await referenceForm
    .getByRole("button", { name: "Save reference" })
    .click();
  const savedMaterial = (await (await materialResponse).json()) as {
    id: string;
    title: string;
    type: string;
    taskId: string | null;
    noteId: string | null;
    projectId: string | null;
  };
  expect(savedMaterial).toEqual(
    expect.objectContaining({
      title: "YouTube material",
      type: "youtube",
      taskId: projectTask.id,
      noteId: savedNote.id,
      projectId: null
    })
  );
  const referenceCard = page
    .locator(".material-item")
    .filter({ hasText: "YouTube material" });
  await expect(referenceCard).toContainText("Task: Connect the research trail");
  await expect(referenceCard).toContainText(
    "Note: The Task owns this decision context."
  );
  await expect(referenceCard).toContainText("Journal relationships");
});

test("announces recovery after local Note validation fails and a retry saves", async ({
  page
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  const form = page.locator(".capture-form").filter({ hasText: "New note" });

  await form
    .getByPlaceholder("Capture a thought, decision, or reminder.")
    .fill("A recovered Note draft.");
  await form
    .getByPlaceholder("Tags, comma separated")
    .fill("x".repeat(51));
  await form.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".app-error-toast")).toContainText(
    "Each note tag must be 50 characters or fewer."
  );

  await form.getByPlaceholder("Tags, comma separated").fill("recovered");
  await form.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.locator(".sr-only[role=status]", { hasText: "Saved." })
  ).toHaveText("Saved.");
  await expect(
    form.getByPlaceholder("Capture a thought, decision, or reminder.")
  ).toHaveValue("");
});

test("reaches older Note options and retains every Reference field after mismatched and rejected saves on phone", async ({
  page
}) => {
  seedJournalHistory();
  const project = await createProject(page, "Retained relationship");
  const task = await createTask(page, "Standalone reference task", null);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("menu", { name: "More destinations" })
    .getByRole("menuitem", { name: "Journal" })
    .click();
  await page.getByRole("radio", { name: /References/ }).click();

  const form = page.locator(".capture-form").filter({
    hasText: "Save reference"
  });
  const linkedNote = form.getByLabel("Reference linked note");
  await expect(linkedNote).toBeEnabled();
  await expect(linkedNote.locator("option")).toHaveCount(51);
  await form.getByRole("button", { name: "Load older notes" }).click();
  await expect(linkedNote.locator("option")).toHaveCount(101);
  await form.getByRole("button", { name: "Load older notes" }).click();
  await expect(linkedNote.locator("option")).toHaveCount(106);

  await form.getByPlaceholder("Title").fill("Retained reference draft");
  await form
    .getByPlaceholder("URL")
    .fill("https://example.com/retained-reference");
  await form
    .getByPlaceholder("Why this matters")
    .fill("Every relationship must survive.");
  await form.getByLabel("Reference linked task").selectOption(task.id);
  await linkedNote.selectOption("journal-note-000");
  await form.getByLabel("Project", { exact: true }).selectOption(project.id);

  let attempts = 0;
  await page.route("**/api/materials", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      const upstream = await route.fetch();
      const material = (await upstream.json()) as Record<string, unknown>;
      await route.fulfill({
        response: upstream,
        contentType: "application/json",
        body: JSON.stringify({ ...material, noteId: null })
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "ATTRIBUTION_CONFLICT",
        error: "The selected note belongs to a different project."
      })
    });
  });

  await form.getByRole("button", { name: "Save reference" }).click();
  await expect(page.getByText(
    "The reference could not be saved. Your draft is still here.",
    { exact: true }
  )).toBeVisible();
  await expectCompleteReferenceDraft(form, {
    taskId: task.id,
    noteId: "journal-note-000",
    projectId: project.id
  });

  await form.getByRole("button", { name: "Save reference" }).click();
  await expect(page.getByText(
    "The selected note belongs to a different project.",
    { exact: true }
  )).toBeVisible();
  await expectCompleteReferenceDraft(form, {
    taskId: task.id,
    noteId: "journal-note-000",
    projectId: project.id
  });

  const dimensions = await form.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    right: element.getBoundingClientRect().right,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1
  );
  expect(dimensions.right).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1
  );
});

test("Note and Reference routes return typed relationship failures without persistence", async ({
  page
}) => {
  const projectA = await createProject(page, "Project A");
  const projectB = await createProject(page, "Project B");
  const taskA = await createTask(page, "Task in Project A", projectA.id);
  const noteBResponse = await page.request.post("/api/notes", {
    data: {
      content: "Existing Project B note",
      tags: [],
      projectId: projectB.id
    }
  });
  expect(noteBResponse.status()).toBe(201);
  const noteB = (await noteBResponse.json()) as { id: string };

  const before = await exportJournalCounts(page);
  const cases = [
    {
      url: "/api/notes",
      body: { content: "Missing Task", taskId: "missing-task" },
      status: 404,
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked task could not be found."
    },
    {
      url: "/api/notes",
      body: {
        content: "Missing Project",
        taskId: taskA.id,
        projectId: "missing-project"
      },
      status: 404,
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked project could not be found."
    },
    {
      url: "/api/notes",
      body: {
        content: "Conflicting Note",
        taskId: taskA.id,
        projectId: projectB.id
      },
      status: 409,
      code: "ATTRIBUTION_CONFLICT",
      error: "The selected task belongs to a different project."
    },
    {
      url: "/api/materials",
      body: {
        url: "https://example.com/missing-note",
        noteId: "missing-note"
      },
      status: 404,
      code: "RELATIONSHIP_NOT_FOUND",
      error: "The linked note could not be found."
    },
    {
      url: "/api/materials",
      body: {
        url: "https://example.com/conflicting-note",
        taskId: taskA.id,
        noteId: noteB.id
      },
      status: 409,
      code: "ATTRIBUTION_CONFLICT",
      error: "The selected note belongs to a different project."
    }
  ] as const;

  for (const contract of cases) {
    const response = await page.request.post(contract.url, {
      data: contract.body
    });
    expect(response.status()).toBe(contract.status);
    expect(await response.json()).toEqual({
      code: contract.code,
      error: contract.error
    });
  }

  expect(await exportJournalCounts(page)).toEqual(before);
});

async function expectCompleteReferenceDraft(
  form: Locator,
  relationships: {
    taskId: string;
    noteId: string;
    projectId: string;
  }
) {
  await expect(form.getByPlaceholder("Title")).toHaveValue(
    "Retained reference draft"
  );
  await expect(form.getByPlaceholder("URL")).toHaveValue(
    "https://example.com/retained-reference"
  );
  await expect(form.getByPlaceholder("Why this matters")).toHaveValue(
    "Every relationship must survive."
  );
  await expect(form.getByLabel("Reference linked task")).toHaveValue(
    relationships.taskId
  );
  await expect(form.getByLabel("Reference linked note")).toHaveValue(
    relationships.noteId
  );
  await expect(form.getByLabel("Project", { exact: true })).toHaveValue(
    relationships.projectId
  );
}

async function exportJournalCounts(page: Page) {
  const response = await page.request.get("/api/agent-export");
  expect(response.ok()).toBe(true);
  const exported = (await response.json()) as {
    notes: unknown[];
    materials: unknown[];
  };
  return {
    notes: exported.notes.length,
    materials: exported.materials.length
  };
}
