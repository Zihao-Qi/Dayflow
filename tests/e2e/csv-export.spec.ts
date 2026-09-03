import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import {
  resetTestDatabase,
  setFocusSessionElapsedMinutes
} from "./database";
import {
  activityHeaders,
  parseCsv,
  taskHeaders
} from "../csv-test-helpers";

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

async function openDataAndBackups(page: Page) {
  await page
    .getByRole("button", { name: "Data & backups", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Data & backups",
    exact: true
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Portable CSV exports", { exact: true })
  ).toBeVisible();
  return dialog;
}

test("exports complete Task and Activity history with canonical contracts", async ({
  page
}) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: "@Roadmap, 2026" }
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };

  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "=SUM(1,1), literal ✨",
      date: null,
      deadline: "2027-01-15",
      projectId: project.id
    }
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };

  const manualResponse = await page.request.post("/api/activities", {
    data: {
      date: "2025-01-15",
      startTime: "09:30",
      durationMinutes: 35,
      category: "Deep, Work",
      note: '+SUM(1,1)\nLiteral "quoted"',
      taskId: task.id
    }
  });
  expect(manualResponse.status()).toBe(201);
  const manual = (await manualResponse.json()) as { id: string };

  const focusStart = await page.request.post("/api/focus-session", {
    data: {
      kind: "FOCUS",
      plannedMinutes: 25,
      label: "Exported Focus evidence",
      taskId: task.id
    }
  });
  expect(focusStart.status()).toBe(201);
  const { session } = (await focusStart.json()) as {
    session: { id: string };
  };
  setFocusSessionElapsedMinutes(session.id, 3);
  const focusComplete = await page.request.patch(
    `/api/focus-session/${session.id}`,
    { data: { action: "complete" } }
  );
  expect(focusComplete.ok()).toBe(true);

  const tasksResponse = await page.request.get("/api/exports/tasks");
  await expectCanonicalResponse(tasksResponse, "tasks", 1);
  const taskRecords = parseCsv(await tasksResponse.text());
  expect(taskRecords[0]).toEqual(taskHeaders);
  expect(taskRecords).toHaveLength(2);
  expect(record(taskHeaders, taskRecords[1])).toEqual(
    expect.objectContaining({
      task_id: task.id,
      title: "'=SUM(1,1), literal ✨",
      scheduled_date: "",
      deadline_date: "2027-01-15",
      project_id: project.id,
      project_name: "'@Roadmap, 2026"
    })
  );

  const activitiesResponse = await page.request.get(
    "/api/exports/activities"
  );
  await expectCanonicalResponse(activitiesResponse, "activities", 2);
  const activityRecords = parseCsv(await activitiesResponse.text());
  expect(activityRecords[0]).toEqual(activityHeaders);
  expect(activityRecords).toHaveLength(3);

  const exportedActivities = activityRecords.slice(1).map((row) =>
    record(activityHeaders, row)
  );
  expect(exportedActivities.map((activity) => activity.origin)).toEqual([
    "MANUAL",
    "FOCUS"
  ]);
  const manualRow = exportedActivities.find(
    (activity) => activity.activity_id === manual.id
  );
  expect(manualRow).toEqual(
    expect.objectContaining({
      local_date: "2025-01-15",
      local_start_time: "09:30",
      duration_minutes: "35",
      category: "Deep, Work",
      note: '\'+SUM(1,1)\nLiteral "quoted"',
      origin: "MANUAL",
      task_id: task.id,
      task_title: "'=SUM(1,1), literal ✨",
      direct_project_id: "",
      attributed_project_id: project.id,
      attributed_project_name: "'@Roadmap, 2026",
      focus_session_id: ""
    })
  );
  const focusRow = exportedActivities.find(
    (activity) => activity.focus_session_id === session.id
  );
  expect(focusRow).toEqual(
    expect.objectContaining({
      duration_minutes: "3",
      origin: "FOCUS",
      task_id: task.id,
      attributed_project_id: project.id
    })
  );
  expect(Date.parse(manualRow?.started_at_utc ?? "")).not.toBeNaN();
  expect(manualRow?.timezone).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$|^UTC$/);
});

test("downloads validated CSV files and refuses a malformed response", async ({
  page
}) => {
  const taskResponse = await page.request.post("/api/tasks", {
    data: {
      title: "Portable export evidence",
      date: null
    }
  });
  expect(taskResponse.status()).toBe(201);

  await openDashboard(page);
  const dialog = await openDataAndBackups(page);
  await expect(
    dialog.getByText(
      "Complete history for spreadsheets and analysis. CSV is not a recovery backup.",
      { exact: true }
    )
  ).toBeVisible();

  const taskDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download Tasks CSV", exact: true })
    .click();
  const downloadedTaskFile = await taskDownload;
  expect(downloadedTaskFile.suggestedFilename()).toMatch(
    /^dayflow-tasks-\d{4}-\d{2}-\d{2}\.csv$/
  );
  const taskPath = await downloadedTaskFile.path();
  expect(taskPath).not.toBeNull();
  const taskBody = await readFile(taskPath!, "utf8");
  expect(parseCsv(taskBody)[1][1]).toBe("Portable export evidence");
  await expect(dialog.getByRole("status")).toContainText(
    "Task CSV downloaded with 1 records."
  );

  const activityDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", {
      name: "Download Activities CSV",
      exact: true
    })
    .click();
  const downloadedActivityFile = await activityDownload;
  expect(downloadedActivityFile.suggestedFilename()).toMatch(
    /^dayflow-activities-\d{4}-\d{2}-\d{2}\.csv$/
  );
  const activityPath = await downloadedActivityFile.path();
  expect(activityPath).not.toBeNull();
  const activityBody = await readFile(activityPath!, "utf8");
  expect(parseCsv(activityBody)).toEqual([activityHeaders]);
  await expect(dialog.getByRole("status")).toContainText(
    "Activity CSV downloaded with 0 records."
  );

  let malformedDownloads = 0;
  page.on("download", () => {
    malformedDownloads += 1;
  });
  await page.route("**/api/exports/activities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      headers: {
        "Content-Disposition":
          'attachment; filename="dayflow-activities-2026-07-28.csv"',
        "X-Dayflow-Export-Format": "dayflow-csv",
        "X-Dayflow-Export-Kind": "activities",
        "X-Dayflow-Export-Version": "999",
        "X-Dayflow-File-Name": "dayflow-activities-2026-07-28.csv",
        "X-Dayflow-Record-Count": "0"
      },
      body: "\uFEFFactivity_id\r\n"
    });
  });
  await dialog
    .getByRole("button", { name: "Download Activities CSV", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Dayflow returned an invalid Activity CSV. Try again."
  );
  await expect(
    dialog.getByRole("button", {
      name: "Download Activities CSV",
      exact: true
    })
  ).toBeEnabled();
  await expect.poll(() => malformedDownloads).toBe(0);
});

async function expectCanonicalResponse(
  response: APIResponse,
  kind: "tasks" | "activities",
  recordCount: number
) {
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["content-type"]).toBe("text/csv; charset=utf-8");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-dayflow-export-format"]).toBe("dayflow-csv");
  expect(headers["x-dayflow-export-version"]).toBe("1");
  expect(headers["x-dayflow-export-kind"]).toBe(kind);
  expect(headers["x-dayflow-record-count"]).toBe(String(recordCount));
  expect(headers["x-dayflow-file-name"]).toMatch(
    new RegExp(`^dayflow-${kind}-\\d{4}-\\d{2}-\\d{2}\\.csv$`)
  );
  expect(headers["content-disposition"]).toBe(
    `attachment; filename="${headers["x-dayflow-file-name"]}"`
  );
}

function record(headers: string[], values: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [header, values[index]])
  );
}
