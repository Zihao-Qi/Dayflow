import { expect, test, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  seedMalformedJournalTags,
  seedJournalSearchHistory,
  seedJournalSearchTies
} from "./database";

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

test("history routes search complete Evidence with exact tags and query-bound cursors", async ({
  page
}) => {
  seedJournalSearchHistory();
  seedJournalSearchTies();
  const specialNote = await page.request.post("/api/notes", {
    data: {
      content: "Literal %_\\! marker",
      tags: ["symbols"]
    }
  });
  expect(specialNote.status()).toBe(201);

  const unfiltered = await getHistory(page, "/api/notes?limit=50");
  expect(unfiltered.totalCount).toBe(129);
  expect(unfiltered.items).toHaveLength(50);
  expect(unfiltered.nextCursor).not.toBeNull();

  const unfilteredReferences = await getHistory(
    page,
    "/api/materials?limit=50"
  );
  expect(unfilteredReferences.totalCount).toBe(125);
  expect(unfilteredReferences.items).toHaveLength(50);
  expect(unfilteredReferences.nextCursor).not.toBeNull();

  const firstPage = await getHistory(
    page,
    "/api/notes?limit=50&q=NEEDLE&tag=%23Design%20Systems"
  );
  expect(firstPage.totalCount).toBe(63);
  expect(firstPage.items).toHaveLength(50);
  expect(firstPage.items[0]).toEqual(
    expect.objectContaining({
      id: "search-note-124",
      tags: ["design-systems", "archive"]
    })
  );
  expect(firstPage.nextCursor).not.toBeNull();

  const secondPage = await getHistory(
    page,
    `/api/notes?limit=50&q=NEEDLE&tag=design-systems&cursor=${encodeURIComponent(
      firstPage.nextCursor ?? ""
    )}`
  );
  expect(secondPage.totalCount).toBe(63);
  expect(secondPage.items).toHaveLength(13);
  expect(secondPage.items.at(-1)).toEqual(
    expect.objectContaining({ id: "search-note-000" })
  );
  expect(secondPage.nextCursor).toBeNull();

  const mismatchedCursor = await page.request.get(
    `/api/notes?q=ordinary&tag=design-systems&cursor=${encodeURIComponent(
      firstPage.nextCursor ?? ""
    )}`
  );
  expect(mismatchedCursor.status()).toBe(400);
  expect(await mismatchedCursor.json()).toEqual({
    code: "INVALID_CURSOR",
    error: "The pagination cursor is invalid."
  });

  seedMalformedJournalTags();
  const exactTag = await getHistory(page, "/api/notes?tag=design&limit=100");
  expect(exactTag.totalCount).toBe(62);
  expect(
    exactTag.items.every((item) => item.tags?.includes("design"))
  ).toBe(true);
  expect(
    exactTag.items.some((item) => item.tags?.includes("design-systems"))
  ).toBe(false);
  const malformedTags = await getHistory(
    page,
    "/api/notes?q=malformed&tag=design"
  );
  expect(malformedTags.totalCount).toBe(0);
  expect(malformedTags.items).toEqual([]);

  const combinedMiss = await getHistory(
    page,
    "/api/notes?q=needle&tag=design"
  );
  expect(combinedMiss.totalCount).toBe(0);
  expect(combinedMiss.items).toEqual([]);

  const literal = await getHistory(
    page,
    `/api/notes?q=${encodeURIComponent("%_\\!")}`
  );
  expect(literal.totalCount).toBe(1);
  expect(literal.items[0]).toEqual(
    expect.objectContaining({ content: "Literal %_\\! marker" })
  );

  const tieFirst = await getHistory(
    page,
    "/api/notes?q=tie%20search&limit=2"
  );
  expect(tieFirst.items.map((item) => item.id)).toEqual([
    "search-tie-c",
    "search-tie-b"
  ]);
  const tieSecond = await getHistory(
    page,
    `/api/notes?q=tie%20search&limit=2&cursor=${encodeURIComponent(
      tieFirst.nextCursor ?? ""
    )}`
  );
  expect(tieSecond.items.map((item) => item.id)).toEqual(["search-tie-a"]);
  expect(tieSecond.nextCursor).toBeNull();

  const allReferenceFields = await getHistory(
    page,
    "/api/materials?q=BEACON&limit=50"
  );
  expect(allReferenceFields.totalCount).toBe(125);
  expect(allReferenceFields.items).toHaveLength(50);
  const secondReferencePage = await getHistory(
    page,
    `/api/materials?q=BEACON&limit=50&cursor=${encodeURIComponent(
      allReferenceFields.nextCursor ?? ""
    )}`
  );
  expect(secondReferencePage.totalCount).toBe(125);
  expect(secondReferencePage.items).toHaveLength(50);
  const thirdReferencePage = await getHistory(
    page,
    `/api/materials?q=BEACON&limit=50&cursor=${encodeURIComponent(
      secondReferencePage.nextCursor ?? ""
    )}`
  );
  expect(thirdReferencePage.totalCount).toBe(125);
  expect(thirdReferencePage.items).toHaveLength(25);
  expect(thirdReferencePage.items.at(-1)).toEqual(
    expect.objectContaining({ id: "search-material-000" })
  );
  expect(thirdReferencePage.nextCursor).toBeNull();
  for (const query of [
    "Beacon title 120",
    "example.com/beacon/121",
    "Beacon notes 122"
  ]) {
    const result = await getHistory(
      page,
      `/api/materials?q=${encodeURIComponent(query)}`
    );
    expect(result.totalCount).toBe(1);
  }

  const invalidCases = [
    ["/api/notes?q=one&q=two", "Provide only one Journal search query."],
    ["/api/notes?tag=one&tag=two", "Provide only one Note tag filter."],
    ["/api/materials?tag=", "Tag filtering is available only for Notes."],
    [
      `/api/notes?q=${"x".repeat(201)}`,
      "Journal search must be 200 characters or fewer."
    ],
    ["/api/notes?q=%00", "Journal search cannot contain control characters."]
  ] as const;
  for (const [url, error] of invalidCases) {
    const response = await page.request.get(url);
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      code: "VALIDATION_ERROR",
      error
    });
  }

  const exported = await page.request.get("/api/agent-export");
  const records = (await exported.json()) as {
    notes: unknown[];
    materials: unknown[];
  };
  expect(records.notes).toHaveLength(131);
  expect(records.materials).toHaveLength(125);
});

test("Note filters reach older matches without changing drafts or linked-Note options", async ({
  page
}) => {
  seedJournalSearchHistory();
  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(page.getByRole("radio", { name: "Notes · 125" })).toBeVisible();

  const noteForm = page.locator(".capture-form").filter({ hasText: "New note" });
  await noteForm
    .getByPlaceholder("Capture a thought, decision, or reminder.")
    .fill("Unsaved search-independent draft");
  await noteForm
    .getByPlaceholder("Tags, comma separated")
    .fill("capture-draft");

  const search = page.getByRole("search", { name: "Search Notes" });
  await search.getByLabel("Search Notes").fill("needle");
  await search.getByLabel("Filter by tag").fill("#Design Systems");
  await expect(page.getByRole("radio", { name: "Notes · 63" })).toBeVisible();
  await expect(page.getByText("Needle note 124", { exact: true })).toBeVisible();
  await expect(page.getByText("Ordinary note 123", { exact: true })).toHaveCount(
    0
  );

  let appendFailed = false;
  await page.route("**/api/notes?*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !appendFailed &&
      url.searchParams.has("cursor") &&
      url.searchParams.get("q") === "needle"
    ) {
      appendFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          error: "Older matching Notes could not be loaded."
        })
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByText("Older matching Notes could not be loaded.", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText("Needle note 124", { exact: true })).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();
  await expect(page.getByText("All 63 notes loaded.", { exact: true })).toBeVisible();
  await page.unroute("**/api/notes?*");
  await expect(
    noteForm.getByPlaceholder("Capture a thought, decision, or reminder.")
  ).toHaveValue("Unsaved search-independent draft");
  await expect(
    noteForm.getByPlaceholder("Tags, comma separated")
  ).toHaveValue("capture-draft");

  await search.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("radio", { name: "Notes · 125" })).toBeVisible();
  const latest = page
    .locator(".note-card")
    .filter({ hasText: "Needle note 124" });
  await latest.getByRole("button", { name: "#design-systems" }).click();
  await expect(search.getByLabel("Filter by tag")).toHaveValue(
    "design-systems"
  );
  await expect(page.getByRole("radio", { name: "Notes · 63" })).toBeVisible();

  await page.getByRole("radio", { name: /References/ }).click();
  const linkedNote = page.getByLabel("Reference linked note");
  await expect(linkedNote.locator("option")).toHaveCount(51);
  await page.getByRole("button", { name: "Load older notes" }).click();
  await page.getByRole("button", { name: "Load older notes" }).click();
  await expect(linkedNote.locator("option")).toHaveCount(126);
  await linkedNote.selectOption("search-note-000");

  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(search.getByLabel("Filter by tag")).toHaveValue(
    "design-systems"
  );
  await page.getByRole("radio", { name: /References/ }).click();
  await expect(page.getByLabel("Reference linked note").locator("option")).toHaveCount(
    126
  );
  await expect(page.getByLabel("Reference linked note")).toHaveValue(
    "search-note-000"
  );
});

test("confirmed creates preserve already-loaded unfiltered history", async ({
  page
}) => {
  seedJournalSearchHistory();
  await openDashboard(page);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("radio", { name: /Notes/ }).click();
  await expect(page.getByRole("radio", { name: "Notes · 125" })).toBeVisible();

  await page.getByRole("button", { name: "Load more" }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("All 125 notes loaded.", { exact: true })).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();

  let noteReconcileFailed = false;
  await page.route("**/api/notes?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      !noteReconcileFailed &&
      route.request().method() === "GET" &&
      !requestUrl.searchParams.has("cursor")
    ) {
      noteReconcileFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          error: "Fresh Note history could not be reconciled."
        })
      });
      return;
    }
    await route.continue();
  });
  await page
    .getByPlaceholder("Capture a thought, decision, or reminder.")
    .fill("Newest reconciled note");
  const noteSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  expect((await noteSave).ok()).toBe(true);
  await expect(
    page.getByText("Fresh Note history could not be reconciled.", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Newest reconciled note", { exact: true })).toBeVisible();
  await expect(page.getByText("Needle note 000", { exact: true })).toBeVisible();
  await expect(page.getByText("All 126 notes loaded.", { exact: true })).toBeVisible();
  await page.unroute("**/api/notes?*");

  await page.getByRole("radio", { name: /References/ }).click();
  await expect(
    page.getByRole("radio", { name: "References · 125" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByText("All 125 references loaded.", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Beacon title 000", { exact: true })).toBeVisible();

  let referenceReconcileFailed = false;
  await page.route("**/api/materials?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      !referenceReconcileFailed &&
      route.request().method() === "GET" &&
      !requestUrl.searchParams.has("cursor")
    ) {
      referenceReconcileFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          error: "Fresh Reference history could not be reconciled."
        })
      });
      return;
    }
    await route.continue();
  });
  await page.getByPlaceholder("Title", { exact: true }).fill(
    "Newest reconciled reference"
  );
  await page.getByPlaceholder("URL", { exact: true }).fill(
    "https://example.com/reconciled"
  );
  const referenceSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/materials") &&
      response.request().method() === "POST"
  );
  await page
    .getByRole("button", { name: "Save reference", exact: true })
    .click();
  expect((await referenceSave).ok()).toBe(true);
  await expect(
    page.getByText("Fresh Reference history could not be reconciled.", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText("Beacon title 000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Newest reconciled reference", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Beacon title 000", { exact: true })).toBeVisible();
  await expect(
    page.getByText("All 126 references loaded.", { exact: true })
  ).toBeVisible();
  await page.unroute("**/api/materials?*");
});

test("Reference search retries failures, rejects stale responses, and fits on phone", async ({
  page
}) => {
  seedJournalSearchHistory();
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
  await form.getByPlaceholder("Title").fill("Unsaved Reference");
  await form.getByPlaceholder("URL").fill("https://example.com/unsaved");
  await form
    .getByPlaceholder("Why this matters")
    .fill("Search must not change this draft.");

  let brokenAttempts = 0;
  await page.route("**/api/materials?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const query = requestUrl.searchParams.get("q");
    if (query === "broken") {
      brokenAttempts += 1;
      if (brokenAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "INTERNAL_ERROR",
            error: "Reference search is temporarily unavailable."
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [materialRecord("recovered", "Recovered Reference")],
          nextCursor: null,
          totalCount: 1
        })
      });
      return;
    }
    if (query === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [materialRecord("slow", "Stale slow result")],
          nextCursor: null,
          totalCount: 1
        })
      }).catch(() => undefined);
      return;
    }
    if (query === "fast") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [materialRecord("fast", "Current fast result")],
          nextCursor: null,
          totalCount: 1
        })
      });
      return;
    }
    await route.continue();
  });

  const search = page.getByRole("search", { name: "Search References" });
  await search.getByLabel("Search References").fill("broken");
  await expect(
    page.getByText("Reference search is temporarily unavailable.", {
      exact: true
    })
  ).toBeVisible();
  await expect(
    page.getByText("No references match this search.", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Recovered Reference", { exact: true })).toBeVisible();

  const slowRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/materials" && url.searchParams.get("q") === "slow";
  });
  await search.getByLabel("Search References").fill("slow");
  await slowRequest;
  await search.getByLabel("Search References").fill("fast");
  await expect(page.getByText("Current fast result", { exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText("Stale slow result", { exact: true })).toHaveCount(0);

  await expect(form.getByPlaceholder("Title")).toHaveValue("Unsaved Reference");
  await expect(form.getByPlaceholder("URL")).toHaveValue(
    "https://example.com/unsaved"
  );
  await expect(form.getByPlaceholder("Why this matters")).toHaveValue(
    "Search must not change this draft."
  );

  for (const element of [search, form]) {
    const dimensions = await element.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      right: node.getBoundingClientRect().right,
      viewportWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1
    );
    expect(dimensions.right).toBeLessThanOrEqual(
      dimensions.viewportWidth + 1
    );
  }
});

type HistoryItem = {
  id: string;
  content?: string;
  tags?: string[];
  title?: string;
};

async function getHistory(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    items: HistoryItem[];
    nextCursor: string | null;
    totalCount: number;
  };
}

function materialRecord(id: string, title: string) {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    type: "website",
    notes: "",
    taskId: null,
    noteId: null,
    projectId: null,
    createdAt: "2026-07-29T12:00:00.000Z"
  };
}
