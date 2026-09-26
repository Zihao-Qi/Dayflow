import { expect, test, type Page } from "@playwright/test";
import { resetTestDatabase } from "./database";

test.beforeEach(() => {
  resetTestDatabase();
});

async function openToday(page: Page) {
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

const habitsCard = (page: Page) => page.getByRole("region", { name: "Habits" });

async function createHabit(page: Page, name: string) {
  const created = await page.request.post("/api/habits", { data: { name } });
  expect(created.ok(), await created.text()).toBe(true);
  return created.json();
}

test("a Check-in recorded from Today survives a reload", async ({ page }) => {
  await createHabit(page, "Morning stretch");
  await openToday(page);

  const toggle = habitsCard(page).getByRole("button", { name: /Morning stretch:/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("not recorded today");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("done today");

  // The state has to come back from storage, not from component memory.
  await page.reload();
  const afterReload = habitsCard(page).getByRole("button", { name: /Morning stretch:/ });
  await expect(afterReload).toHaveAttribute("aria-pressed", "true");
  await expect(afterReload).toContainText("done today");
});

test("an unrecorded Habit reads differently from one recorded as not done", async ({ page }) => {
  // The storage model keeps these apart, so the page must not collapse them.
  const habit = await createHabit(page, "Evening walk");
  const untouched = await createHabit(page, "Never touched");

  await openToday(page);
  const card = habitsCard(page);
  const walkRow = card.locator(`[data-habit="${habit.id}"]`);
  const untouchedRow = card.locator(`[data-habit="${untouched.id}"]`);
  const walkToggle = walkRow.getByRole("button", { name: /Evening walk:/ });
  const untouchedToggle = untouchedRow.getByRole("button", { name: /Never touched:/ });

  await expect(walkToggle).toContainText("not recorded today");
  await expect(untouchedToggle).toContainText("not recorded today");

  const putPayloads: unknown[] = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/habits/${habit.id}/check-in`) && req.method() === "PUT") {
      putPayloads.push(req.postDataJSON());
    }
  });

  const checkInPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/habits/${habit.id}/check-in`) &&
      resp.request().method() === "PUT"
  );

  // Assert and use distinct accessible name for the unrecorded action (satisfies WCAG 2.5.3 Label in Name)
  const markNotDoneButton = card.getByRole("button", {
    name: `Mark not done for ${habit.name}`
  });
  await expect(markNotDoneButton).toBeVisible();
  await markNotDoneButton.click();
  const checkInResponse = await checkInPromise;
  expect(checkInResponse.ok()).toBe(true);

  // Directly records done:false in ONE PUT without transiently writing done:true
  expect(putPayloads).toHaveLength(1);
  expect(putPayloads[0]).toMatchObject({ done: false });

  await expect(walkToggle).toContainText("not done today");
  await expect(walkToggle).toHaveAttribute("aria-pressed", "false");
  await expect(
    card.getByRole("button", { name: `Mark not done for ${habit.name}` })
  ).toHaveCount(0);

  // Untouched habit remains unrecorded with its own distinct mark-not-done button
  await expect(untouchedToggle).toContainText("not recorded today");
  await expect(
    card.getByRole("button", { name: `Mark not done for ${untouched.name}` })
  ).toBeVisible();

  // State persists across reload from storage
  await page.reload();
  const cardAfterReload = habitsCard(page);
  const reloadedWalkRow = cardAfterReload.locator(`[data-habit="${habit.id}"]`);
  const reloadedUntouchedRow = cardAfterReload.locator(`[data-habit="${untouched.id}"]`);
  const reloadedWalkToggle = reloadedWalkRow.getByRole("button", { name: /Evening walk:/ });
  const reloadedUntouchedToggle = reloadedUntouchedRow.getByRole("button", { name: /Never touched:/ });

  await expect(reloadedWalkToggle).toContainText("not done today");
  await expect(reloadedWalkToggle).toHaveAttribute("aria-pressed", "false");
  await expect(
    cardAfterReload.getByRole("button", { name: `Mark not done for ${habit.name}` })
  ).toHaveCount(0);
  await expect(reloadedUntouchedToggle).toContainText("not recorded today");
  await expect(
    cardAfterReload.getByRole("button", { name: `Mark not done for ${untouched.name}` })
  ).toBeVisible();
});

test("the first Habit is created from the card itself", async ({ page }) => {
  // The card renders with no Habits on purpose: it is the only place to make
  // the first one. Hiding it when empty left the feature unreachable.
  await openToday(page);
  const card = habitsCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("No habits yet");

  await card.getByLabel("New habit name").fill("Morning stretch");
  await card.getByRole("button", { name: "Add habit" }).click();

  await expect(card.getByRole("button", { name: /Morning stretch:/ })).toBeVisible();
  await expect(card).not.toContainText("No habits yet");

  // It has to be stored, not just rendered.
  await page.reload();
  await expect(
    habitsCard(page).getByRole("button", { name: /Morning stretch:/ })
  ).toBeVisible();
});

test("retries an unconfirmed Habit create with the same mutation ID and retires it on success", async ({
  page
}) => {
  await openToday(page);
  const card = habitsCard(page);

  const mutationIds: string[] = [];
  let hideFirstSuccess = true;

  await page.route("**/api/habits", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const mutationId = (await request.headerValue("X-Dayflow-Mutation-Id")) ?? "";
    mutationIds.push(mutationId);

    if (hideFirstSuccess) {
      hideFirstSuccess = false;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary network failure." })
      });
      return;
    }
    await route.continue();
  });

  const input = card.getByLabel("New habit name");
  const addButton = card.getByRole("button", { name: "Add habit" });

  await input.fill("Morning stretch");
  await addButton.click();

  // Failed create keeps draft in input and displays error
  await expect(input).toHaveValue("Morning stretch");
  await expect(page.locator(".sr-only[role='status']")).toHaveText("Habit status unconfirmed. Your draft is still here.");

  // Retry with same draft
  await addButton.click();

  // Wait for button to be visible and input cleared
  await expect(card.getByRole("button", { name: /Morning stretch:/ })).toBeVisible();
  await expect(input).toHaveValue("");
  expect(mutationIds.length).toBe(2);
  expect(mutationIds[0]).toBeTruthy();
  expect(mutationIds[1]).toBe(mutationIds[0]);

  // Deliberate subsequent create with the SAME name gets a new mutation ID
  await input.fill("Morning stretch");
  await addButton.click();

  await expect(card.getByRole("button", { name: /Morning stretch:/ })).toHaveCount(2);
  expect(mutationIds.length).toBe(3);
  expect(mutationIds[2]).toBeTruthy();
  expect(mutationIds[2]).not.toBe(mutationIds[0]);

  // Verify DB has exactly 2 distinct habits, not 1 or 3 (retry was idempotent, retirement enabled 2nd creation)
  await page.reload();
  await expect(card.getByRole("button", { name: /Morning stretch:/ })).toHaveCount(2);
});

test("separates confirmed write success from read-refresh failure", async ({ page }) => {
  let habitCreateRequests = 0;
  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "POST") habitCreateRequests += 1;
    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);

  let failRefresh = false;
  let recoveredRefresh = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (failRefresh) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Read refresh offline." })
      });
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    if (recoveredRefresh && Array.isArray(payload.habits) && payload.habits.length > 0) {
      payload.habits.push({
        ...payload.habits[0],
        id: "synced-habit-id",
        name: "Synced habit from refresh"
      });
    }
    await route.fulfill({ response, json: payload });
  });

  const input = card.getByLabel("New habit name");
  const addButton = card.getByRole("button", { name: "Add habit" });

  await input.fill("Morning stretch");
  failRefresh = true;

  await addButton.click();

  // The habit remains visible in the list because write succeeded
  const habitButton = card.getByRole("button", { name: /Morning stretch:/ });
  await expect(habitButton).toBeVisible();
  // Coherent display: not recorded today, canonical target 1 (not fabricated target 7 with 0 days)
  await expect(habitButton).toContainText("not recorded today");
  await expect(card.getByText("0 of 1 this period")).toBeVisible();
  // The draft was cleared on confirmed write
  await expect(input).toHaveValue("");
  // Truthful saved-but-refresh-failed feedback
  const toast = page.locator(".app-error-toast");
  await expect(toast).toContainText("Your change was saved, but Dayflow could not refresh the latest view.");
  const retryButton = toast.getByRole("button", { name: "Retry refresh" });
  await expect(retryButton).toBeVisible();

  // Recover read refresh and click Retry refresh (no page.reload!)
  failRefresh = false;
  recoveredRefresh = true;
  await retryButton.click();

  // Read error is resolved and toast is dismissed
  await expect(toast).toHaveCount(0);
  // Fresh content is visible and preserved
  await expect(habitButton).toBeVisible();
  await expect(card.getByRole("button", { name: /Synced habit from refresh:/ })).toBeVisible();
  // Only a single write request was sent
  expect(habitCreateRequests).toBe(1);
});

test("tracks independent busy states across simultaneous habit check-ins", async ({ page }) => {
  const habitA = await createHabit(page, "Morning stretch");
  const habitB = await createHabit(page, "Evening walk");

  let resolveA: () => void = () => {};
  const gateA = new Promise<void>((r) => { resolveA = r; });
  let resolveB: () => void = () => {};
  const gateB = new Promise<void>((r) => { resolveB = r; });

  await page.route("**/api/habits/*/check-in", async (route) => {
    const url = route.request().url();
    if (url.includes(habitA.id)) {
      await gateA;
      await route.continue();
      return;
    }
    if (url.includes(habitB.id)) {
      await gateB;
      await route.continue();
      return;
    }
    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);

  const buttonA = card.getByRole("button", { name: /Morning stretch:/ });
  const buttonB = card.getByRole("button", { name: /Evening walk:/ });

  await expect(buttonA).toBeEnabled();
  await expect(buttonB).toBeEnabled();

  // Start action on A
  await buttonA.click();
  await expect(buttonA).toBeDisabled();
  await expect(buttonB).toBeEnabled();

  // Start action on B while A is still pending
  await buttonB.click();
  await expect(buttonA).toBeDisabled();
  await expect(buttonB).toBeDisabled();

  // Complete B first
  resolveB();
  await expect(buttonB).toBeEnabled();
  // A must still be disabled, not prematurely re-enabled by B's completion
  await expect(buttonA).toBeDisabled();

  // Complete A
  resolveA();
  await expect(buttonA).toBeEnabled();
});

test("delayed check-in does not mark a new day done after calendar rollover", async ({ page }) => {
  await createHabit(page, "Morning stretch");

  const now = new Date();
  const loadingTime = new Date(now);
  loadingTime.setHours(23, 55, 0, 0);
  const lateToday = new Date(now);
  lateToday.setHours(23, 59, 59, 0);
  await page.clock.install({ time: loadingTime });

  let releaseCheckIn: () => void = () => {};
  const checkInGate = new Promise<void>((resolve) => { releaseCheckIn = resolve; });

  let failTrailingRefresh = false;
  let shiftToNewDay = false;

  await page.route("**/api/habits/*/check-in", async (route) => {
    await checkInGate;
    await route.continue();
  });

  await page.route("**/api/bootstrap", async (route) => {
    if (failTrailingRefresh) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Trailing refresh offline." })
      });
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    if (shiftToNewDay) {
      const currentToday = new Date(payload.today);
      const nextDay = new Date(currentToday);
      nextDay.setDate(nextDay.getDate() + 1);
      payload.today = nextDay.toISOString();
      payload.todayKey = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
      // Note: Deliberately partial fake new-day read that advances todayKey and resets habits[].today
      // without shifting the full days strip, sufficient to verify rollover guard against stale todayKey.
      if (Array.isArray(payload.habits)) {
        payload.habits = payload.habits.map((h: Record<string, unknown>) => ({
          ...h,
          today: null
        }));
      }
    }
    await route.fulfill({ response, json: payload });
  });

  await openToday(page);
  const card = habitsCard(page);
  const button = card.getByRole("button", { name: /Morning stretch:/ });
  await expect(button).toContainText("not recorded today");

  // Trigger check-in for Day 1; it pauses at checkInGate
  await button.click();
  await expect(button).toBeDisabled();

  // While check-in is pending in flight, advance clock across midnight to publish new-day read (Day 2)
  const newDayResponse = page.waitForResponse(
    (res) => res.url().includes("/api/bootstrap") && res.status() === 200
  );
  shiftToNewDay = true;
  await page.clock.pauseAt(lateToday);
  await page.clock.runFor(1_500);
  await newDayResponse;

  // Set trailing refresh to fail
  failTrailingRefresh = true;

  // Release the pending old-day check-in response
  releaseCheckIn();

  // The button re-enables after check-in completes
  await expect(button).toBeEnabled();

  // Under rollover protection, yesterday's check-in must NOT mark today done!
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toContainText("not recorded today");
});

test("cross-midnight rollover resets unsaved amount and note drafts", async ({ page }) => {
  await createHabit(page, "Morning stretch");

  const now = new Date();
  const loadingTime = new Date(now);
  loadingTime.setHours(23, 55, 0, 0);
  const lateToday = new Date(now);
  lateToday.setHours(23, 59, 59, 0);
  await page.clock.install({ time: loadingTime });

  let shiftToNewDay = false;
  let newDayRecorded = false;

  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (shiftToNewDay) {
      const currentToday = new Date(payload.today);
      const nextDay = new Date(currentToday);
      nextDay.setDate(nextDay.getDate() + 1);
      payload.today = nextDay.toISOString();
      payload.todayKey = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
      if (Array.isArray(payload.habits)) {
        payload.habits = payload.habits.map((h: Record<string, unknown>) => ({
          ...h,
          today: newDayRecorded ? { done: true, amount: null, note: null } : null
        }));
      }
    }
    await route.fulfill({ response, json: payload });
  });

  await page.route("**/api/habits/*/check-in", async (route) => {
    if (shiftToNewDay && route.request().method() === "PUT") {
      newDayRecorded = true;
      const data = JSON.parse(route.request().postData() ?? "{}");
      const url = route.request().url();
      const habitIdMatch = url.match(/\/api\/habits\/([^/]+)\/check-in/);
      const habitId = habitIdMatch ? decodeURIComponent(habitIdMatch[1]) : "h-1";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "checkin-new-day",
          habitId,
          date: `${data.date}T12:00:00.000Z`,
          done: data.done,
          amount: data.amount ?? null,
          note: data.note ?? null
        })
      });
      return;
    }
    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);
  const row = card.locator("[data-habit]").first();

  // 1. Record today
  await row.getByRole("button", { name: /Morning stretch:/ }).click();
  await expect(row.getByRole("button", { name: /Morning stretch: done/ })).toBeVisible();

  // 2. Type draft amount and note without saving
  const amountInput = row.getByLabel("Amount for Morning stretch");
  const noteInput = row.getByLabel("Note for Morning stretch");
  await amountInput.fill("42");
  await noteInput.fill("Unsaved draft from yesterday");

  // 3. Advance clock across midnight to publish new-day read
  const newDayResponse = page.waitForResponse(
    (res) => res.url().includes("/api/bootstrap") && res.status() === 200
  );
  shiftToNewDay = true;
  await page.clock.pauseAt(lateToday);
  await page.clock.runFor(1_500);
  await newDayResponse;

  // The new day's row shows unrecorded
  const newDayRow = card.locator("[data-habit]").first();
  await expect(newDayRow.getByRole("button", { name: /Morning stretch: not recorded/ })).toBeVisible();

  // 4. Record the new day
  await newDayRow.getByRole("button", { name: /Morning stretch: not recorded/ }).click();
  await expect(newDayRow.getByRole("button", { name: /Morning stretch: done/ })).toBeVisible();

  // 5. Observe the draft: new day's draft must be empty, not carrying yesterday's unsaved values
  const newAmountInput = newDayRow.getByLabel("Amount for Morning stretch");
  const newNoteInput = newDayRow.getByLabel("Note for Morning stretch");
  await expect(newAmountInput).toHaveValue("");
  await expect(newNoteInput).toHaveValue("");
});

test("retires all pending check-in retry IDs for habit and day upon confirmed success so superseded writes are not replayed", async ({ page }) => {
  await createHabit(page, "Daily meditation");

  let mutationIdA: string | undefined;
  let mutationIdB: string | undefined;
  let mutationIdC: string | undefined;
  let checkInCount = 0;

  await page.route("**/api/habits/*/check-in", async (route) => {
    checkInCount += 1;
    const req = route.request();
    const headers = req.headers();
    const mutationId = headers["x-dayflow-mutation-id"];

    if (checkInCount === 1) {
      // Step 1: Server commits done=true, but client receives network error/abort
      mutationIdA = mutationId;
      const response = await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Network lost after commit" })
      });
      return;
    }

    if (checkInCount === 2) {
      // Step 2: Opposite toggle (done=false) succeeds
      mutationIdB = mutationId;
      await route.continue();
      return;
    }

    if (checkInCount === 3) {
      // Step 3: Original toggle (done=true) clicked again
      mutationIdC = mutationId;
      await route.continue();
      return;
    }

    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);
  const button = card.getByRole("button", { name: /Daily meditation:/ });
  await expect(button).toHaveAttribute("aria-pressed", "false");

  // Step 1: Click done=true. Server commits in DB, client receives 500 and retains mutation ID A.
  await button.click();
  const toast = page.locator(".app-error-toast");
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss" }).click();

  // Sync client view with committed server state without reloading the page session
  const taskInput = page.getByPlaceholder("Add a task for today");
  await taskInput.fill("Sync check");
  await taskInput.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");

  // Step 2: Opposite toggle (done=false). Succeeds normally with mutation ID B.
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(checkInCount).toBe(2);

  // Step 3: Original toggle (done=true) clicked again.
  // Under the fix: Step 2 retired all pending entries for this habit/day, so Step 3 generates fresh mutation ID C.
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect(checkInCount).toBe(3);

  // Crucial check: mutation ID C must NOT reuse mutation ID A from step 1
  expect(mutationIdA).toBeDefined();
  expect(mutationIdC).toBeDefined();
  expect(mutationIdC).not.toBe(mutationIdA);

  // Verify server DB actually persisted done=true rather than replaying old receipt without writing
  await page.reload();
  await openToday(page);
  const reloadedCard = habitsCard(page);
  const reloadedButton = reloadedCard.getByRole("button", { name: /Daily meditation:/ });
  await expect(reloadedButton).toHaveAttribute("aria-pressed", "true");
});

test("creates a Habit with cadence and weekly target from the card", async ({ page }) => {
  await openToday(page);
  const card = habitsCard(page);

  let createPayload: { name?: string; cadence?: string; targetPerWeek?: number } | null = null;
  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "POST") {
      createPayload = JSON.parse(route.request().postData() ?? "{}");
    }
    await route.continue();
  });

  const input = card.getByLabel("New habit name");
  const cadenceSelect = card.getByLabel("Cadence");

  await input.fill("Read book");
  await cadenceSelect.selectOption("TIMES_PER_WEEK");

  const targetInput = card.getByLabel("Target days per week");
  await expect(targetInput).toBeVisible();
  await targetInput.fill("4");

  await card.getByRole("button", { name: "Add habit" }).click();

  const habitToggle = card.getByRole("button", { name: /Read book:/ });
  await expect(habitToggle).toBeVisible();
  expect(createPayload).toEqual({
    name: "Read book",
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 4
  });

  // Verify form resets to defaults on success
  await expect(input).toHaveValue("");
  await expect(cadenceSelect).toHaveValue("DAILY");
  await expect(card.getByLabel("Target days per week")).toHaveCount(0);

  // Survives page reload: assert cadence/target is visible/persisted, not just the name
  await page.reload();
  const reloadedCard = habitsCard(page);
  await expect(reloadedCard.getByRole("button", { name: /Read book:/ })).toBeVisible();
  await expect(reloadedCard.getByText("0 of 1 this period")).toBeVisible();
  const habitsRes = await page.request.get("/api/habits");
  const habitsData = await habitsRes.json();
  const created = habitsData.find((h: { name: string }) => h.name === "Read book");
  expect(created).toMatchObject({
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 4
  });
});

test("changing cadence between failed attempts sends a new mutation ID, not a replay", async ({ page }) => {
  await openToday(page);
  const card = habitsCard(page);

  const mutationIds: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  let failAttempts = 2;

  await page.route("**/api/habits", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const mutationId = (await request.headerValue("X-Dayflow-Mutation-Id")) ?? "";
    mutationIds.push(mutationId);
    payloads.push(JSON.parse(request.postData() ?? "{}"));

    if (failAttempts > 0) {
      failAttempts -= 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Network failure" })
      });
      return;
    }
    await route.continue();
  });

  const input = card.getByLabel("New habit name");
  const cadenceSelect = card.getByLabel("Cadence");
  const addButton = card.getByRole("button", { name: "Add habit" });

  // Attempt 1: DAILY
  await input.fill("Evening stretch");
  await cadenceSelect.selectOption("DAILY");
  await addButton.click();

  // Failed create keeps draft in input
  await expect(input).toHaveValue("Evening stretch");
  expect(mutationIds.length).toBe(1);

  // Attempt 2: Same parameters -> reuses mutation ID
  await addButton.click();
  await expect(input).toHaveValue("Evening stretch");
  expect(mutationIds.length).toBe(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);

  // Attempt 3: Change cadence to TIMES_PER_WEEK target 3 -> MUST send fresh mutation ID
  await cadenceSelect.selectOption("TIMES_PER_WEEK");
  const targetInput = card.getByLabel("Target days per week");
  await targetInput.fill("3");
  await addButton.click();

  // Third attempt succeeds
  await expect(card.getByRole("button", { name: /Evening stretch:/ })).toBeVisible();
  expect(mutationIds.length).toBe(3);
  expect(mutationIds[2]).toBeTruthy();
  expect(mutationIds[2]).not.toBe(mutationIds[0]);
  expect(payloads[2]).toEqual({
    name: "Evening stretch",
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 3
  });
});

test("renames a Habit inline and displays validation error keeping user draft", async ({ page }) => {
  const habit = await createHabit(page, "Morning yoga");
  await openToday(page);
  const card = habitsCard(page);

  const row = card.locator(`[data-habit="${habit.id}"]`);
  const renameButton = row.getByRole("button", { name: "Rename" });
  await renameButton.click();

  const renameInput = row.getByLabel("Rename Morning yoga");
  await expect(renameInput).toBeVisible();
  await expect(renameInput).toBeFocused();
  await expect(renameInput).toHaveValue("Morning yoga");

  // Escape closes the form and restores focus to the row's Rename button (G1)
  await page.keyboard.press("Escape");
  await expect(renameInput).toHaveCount(0);
  await expect(renameButton).toBeFocused();

  // Re-open rename and test Cancel button restores focus (G1)
  await renameButton.click();
  await expect(renameInput).toBeVisible();
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(renameInput).toHaveCount(0);
  await expect(renameButton).toBeFocused();

  // Re-open rename
  await renameButton.click();
  await expect(renameInput).toBeVisible();
  await expect(renameInput).toBeFocused();

  // Attempt to submit overlong name (121 chars) -> 400 validation error, keeping user draft (G2)
  const overlongName = "x".repeat(121);
  await renameInput.fill(overlongName);
  await row.getByRole("button", { name: "Save" }).click();

  // Validation error displayed next to field, and draft kept
  const errorMsg = row.locator(".form-error");
  await expect(errorMsg).toBeVisible();
  await expect(errorMsg).toContainText("Habit name must be 120 characters or fewer.");
  await expect(renameInput).toHaveValue(overlongName);

  // Correct name and save
  await renameInput.fill("Evening yoga");
  await row.getByRole("button", { name: "Save" }).click();

  // Input closes and row displays new name
  await expect(row.getByRole("button", { name: /Evening yoga:/ })).toBeVisible();
  await expect(renameInput).toHaveCount(0);

  // Focus restored to the row's Rename button after Save (G1)
  await expect(row.getByRole("button", { name: "Rename" })).toBeFocused();

  // Persisted in storage
  await page.reload();
  await expect(
    habitsCard(page).getByRole("button", { name: /Evening yoga:/ })
  ).toBeVisible();
});

test("delayed rename settlement is isolated and does not close or mislabel another habit editor", async ({ page }) => {
  const habitA = await createHabit(page, "Habit Alpha");
  const habitB = await createHabit(page, "Habit Beta");
  await openToday(page);
  const card = habitsCard(page);

  const rowA = card.locator(`[data-habit="${habitA.id}"]`);
  const rowB = card.locator(`[data-habit="${habitB.id}"]`);

  // Path 1: Success path isolation
  let releasePatchA: () => void = () => {};
  const patchGateA = new Promise<void>((resolve) => {
    releasePatchA = resolve;
  });

  await page.route(`**/api/habits/${habitA.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await patchGateA;
    }
    await route.continue();
  });

  // Open A and start rename
  await rowA.getByRole("button", { name: "Rename", exact: true }).click();
  const inputA = rowA.getByLabel("Rename Habit Alpha");
  await inputA.fill("Habit Alpha Renamed");
  // Submit A (held in flight at patchGateA)
  await rowA.getByRole("button", { name: "Save" }).click();

  // While A's PATCH is pending, user opens B's rename editor
  await rowB.getByRole("button", { name: "Rename", exact: true }).click();
  const inputB = rowB.getByLabel("Rename Habit Beta");
  await expect(inputB).toBeVisible();

  // Release A's successful PATCH
  const patchPromiseA = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/habits/${habitA.id}`) &&
      resp.request().method() === "PATCH"
  );
  const trailingBootstrapA = page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/bootstrap") &&
      resp.status() === 200
  );
  releasePatchA();
  await patchPromiseA;
  await trailingBootstrapA;
  await expect(
    rowA.getByRole("button", { name: /Habit Alpha Renamed:/ })
  ).toBeVisible();

  // B's editor must remain open under isolation guard
  await expect(inputB).toBeVisible();
  await expect(rowB.locator(".form-error")).toHaveCount(0);

  // Cancel B
  await rowB.getByRole("button", { name: "Cancel" }).click();
  await expect(inputB).toHaveCount(0);

  // Path 2: Failure path isolation
  let releaseFailPatch: () => void = () => {};
  const failPatchGate = new Promise<void>((resolve) => {
    releaseFailPatch = resolve;
  });

  await page.route(`**/api/habits/${habitB.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await failPatchGate;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Validation error on Habit B",
          code: "VALIDATION_ERROR"
        })
      });
      return;
    }
    await route.continue();
  });

  // Open B and submit invalid rename
  await rowB.getByRole("button", { name: "Rename", exact: true }).click();
  const inputB2 = rowB.getByLabel("Rename Habit Beta");
  await inputB2.fill("Habit Beta Attempt");
  await rowB.getByRole("button", { name: "Save" }).click();

  // While B's PATCH is pending, user opens A's rename editor
  await rowA.getByRole("button", { name: "Rename", exact: true }).click();
  const inputA2 = rowA.getByLabel("Rename Habit Alpha Renamed");
  await expect(inputA2).toBeVisible();

  // Release B's failing PATCH
  const failPromiseB = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/habits/${habitB.id}`) &&
      resp.request().method() === "PATCH"
  );
  releaseFailPatch();
  await failPromiseB;

  // A's editor must NOT receive B's error under isolation guard
  await expect(inputA2).toBeVisible();
  await expect(rowA.locator(".form-error")).toHaveCount(0);
});

test("rename and archive retain mutation ID across failures and retire it upon confirmed success", async ({ page }) => {
  const habit = await createHabit(page, "Test Habit");
  await openToday(page);
  const card = habitsCard(page);
  const row = card.locator(`[data-habit="${habit.id}"]`);

  // 1. Rename retry retention and retirement
  const renameMutationIds: string[] = [];
  let failRenameOnce = true;

  await page.route(`**/api/habits/${habit.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const mid = route.request().headers()["x-dayflow-mutation-id"];
      if (mid) renameMutationIds.push(mid);
      if (failRenameOnce) {
        failRenameOnce = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Server error" })
        });
        return;
      }
    }
    await route.continue();
  });

  await row.getByRole("button", { name: "Rename" }).click();
  const renameInput = row.getByLabel("Rename Test Habit");
  await renameInput.fill("Updated Habit");
  // First attempt fails
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.locator(".form-error")).toBeVisible();
  expect(renameMutationIds).toHaveLength(1);

  // Retry with same draft: must reuse mutation ID
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.locator(".form-error")).toHaveCount(0);
  expect(renameMutationIds).toHaveLength(2);
  expect(renameMutationIds[1]).toBe(renameMutationIds[0]);

  // Next rename after confirmed success: must use fresh mutation ID
  await row.getByRole("button", { name: "Rename" }).click();
  const renameInput2 = row.getByLabel("Rename Updated Habit");
  await renameInput2.fill("Final Habit Name");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("button", { name: /Final Habit Name:/ })).toBeVisible();
  expect(renameMutationIds).toHaveLength(3);
  expect(renameMutationIds[2]).not.toBe(renameMutationIds[0]);

  // 2. Archive retry retention and retirement
  const archiveMutationIds: string[] = [];
  let failArchiveOnce = true;

  await page.route(`**/api/habits/${habit.id}/archive`, async (route) => {
    if (route.request().method() === "POST") {
      const mid = route.request().headers()["x-dayflow-mutation-id"];
      if (mid) archiveMutationIds.push(mid);
      if (failArchiveOnce) {
        failArchiveOnce = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Archive offline" })
        });
        return;
      }
    }
    await route.continue();
  });

  await row.getByRole("button", { name: "Archive" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Archive Final Habit Name" });
  await dialog.getByRole("button", { name: "Archive habit" }).click();
  // First attempt failed, row preserved
  await expect(row).toBeVisible();
  expect(archiveMutationIds).toHaveLength(1);

  // Retry archive in the open dialog: must reuse mutation ID
  await dialog.getByRole("button", { name: "Archive habit" }).click();
  await expect(row).toHaveCount(0);
  expect(archiveMutationIds).toHaveLength(2);
  expect(archiveMutationIds[1]).toBe(archiveMutationIds[0]);
});

test("archives a Habit behind a focus-trapped confirmation modal", async ({ page }) => {
  const habit1 = await createHabit(page, "Deep meditation");
  const habit2 = await createHabit(page, "Evening reading");
  await openToday(page);
  const card = habitsCard(page);

  const row1 = card.locator(`[data-habit="${habit1.id}"]`);
  const row2 = card.locator(`[data-habit="${habit2.id}"]`);
  const archiveTrigger1 = row1.getByRole("button", { name: "Archive" });

  // Open archive confirmation
  await archiveTrigger1.click();

  const dialog = page.getByRole("alertdialog", { name: "Archive Deep meditation" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Archiving keeps every Check-in and hides the Habit from Today.");

  // Safe initial focus: lands on "Keep habit", not destructive "Archive habit"
  const keepButton = dialog.getByRole("button", { name: "Keep habit" });
  const archiveConfirmButton = dialog.getByRole("button", { name: "Archive habit" });
  await expect(keepButton).toBeFocused();

  // Tab moves to Archive habit, and Tab again wraps back to Keep habit (focus trapped)
  await page.keyboard.press("Tab");
  await expect(archiveConfirmButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keepButton).toBeFocused();

  // Dismiss via Escape returns focus to the archive trigger
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(archiveTrigger1).toBeFocused();

  // Re-open and dismiss via Keep habit returns focus to the trigger
  await archiveTrigger1.click();
  await expect(dialog).toBeVisible();
  await keepButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(archiveTrigger1).toBeFocused();

  // Re-open and confirm archive
  await archiveTrigger1.click();
  await expect(dialog).toBeVisible();

  // E2: Gate trailing refresh to verify row is removed while refresh is pending
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let gateNextBootstrap = false;

  await page.route("**/api/bootstrap", async (route) => {
    if (gateNextBootstrap) {
      await refreshGate;
    }
    await route.continue();
  });

  gateNextBootstrap = true;
  await archiveConfirmButton.click();

  // Row leaves card immediately without waiting for trailing refresh (E2)
  await expect(row1).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Deep meditation/ })).toHaveCount(0);

  // Release trailing refresh
  releaseRefresh();

  // F3: Focus moves to the next habit's toggle button
  await expect(card.getByRole("button", { name: /Evening reading:/ })).toBeFocused();

  // Archive second habit: when last habit is archived, focus moves to "New habit name" input
  const archiveTrigger2 = row2.getByRole("button", { name: "Archive" });
  await archiveTrigger2.click();
  const dialog2 = page.getByRole("alertdialog", { name: "Archive Evening reading" });
  await expect(dialog2).toBeVisible();
  await dialog2.getByRole("button", { name: "Archive habit" }).click();
  await expect(row2).toHaveCount(0);

  // F3: Focus moves to create input
  await expect(card.getByLabel("New habit name")).toBeFocused();

  // Persisted: both habits stay gone after reload
  await page.reload();
  await expect(habitsCard(page).getByRole("button", { name: /Deep meditation/ })).toHaveCount(0);
  await expect(habitsCard(page).getByRole("button", { name: /Evening reading/ })).toHaveCount(0);
});

test("archive failure during trailing refresh preserves removed row and shows retry refresh toast", async ({ page }) => {
  const habit = await createHabit(page, "Morning stretch");
  await openToday(page);
  const card = habitsCard(page);

  let failRefresh = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (failRefresh) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Read refresh offline." })
      });
      return;
    }
    await route.continue();
  });

  const row = card.locator(`[data-habit="${habit.id}"]`);
  await row.getByRole("button", { name: "Archive" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Archive Morning stretch" });
  await expect(dialog).toBeVisible();

  failRefresh = true;
  await dialog.getByRole("button", { name: "Archive habit" }).click();

  // Row leaves immediately
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toHaveCount(0);

  // Toast appears with retry refresh button
  const toast = page.locator(".app-error-toast");
  await expect(toast).toContainText("Your change was saved, but Dayflow could not refresh the latest view.");
  const retryButton = toast.getByRole("button", { name: "Retry refresh" });
  await expect(retryButton).toBeVisible();

  // Recover refresh and click retry
  failRefresh = false;
  await retryButton.click();
  await expect(toast).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Morning stretch/ })).toHaveCount(0);
});

test("amount and note inputs are disabled until habit is recorded for today", async ({ page }) => {
  const habit = await createHabit(page, "Morning stretch");
  await openToday(page);
  const card = habitsCard(page);

  const row = card.locator(`[data-habit="${habit.id}"]`);
  const amountInput = row.getByLabel("Amount for Morning stretch");
  const noteInput = row.getByLabel("Note for Morning stretch");
  const saveButton = row.getByRole("button", { name: "Save details" });

  // Disabled until recorded
  await expect(row.getByText("Record today first")).toBeVisible();
  await expect(amountInput).toBeDisabled();
  await expect(noteInput).toBeDisabled();
  await expect(saveButton).toBeDisabled();

  // Record today
  await row.getByRole("button", { name: /Morning stretch: not recorded/ }).click();
  await expect(row.getByRole("button", { name: /Morning stretch: done/ })).toBeVisible();

  // Inputs become enabled
  await expect(row.getByText("Record today first")).toHaveCount(0);
  await expect(amountInput).toBeEnabled();
  await expect(noteInput).toBeEnabled();
  await expect(saveButton).toBeEnabled();
});

test("note survives an amount edit when only amount is modified, and clearing note sends null", async ({ page }) => {
  const habit = await createHabit(page, "Daily reading");
  await openToday(page);
  const card = habitsCard(page);

  const row = card.locator(`[data-habit="${habit.id}"]`);
  const amountInput = row.getByLabel("Amount for Daily reading");
  const noteInput = row.getByLabel("Note for Daily reading");
  const saveButton = row.getByRole("button", { name: "Save details" });

  // Record today
  await row.getByRole("button", { name: /Daily reading: not recorded/ }).click();
  await expect(amountInput).toBeEnabled();

  // Set amount to 20 and note to Chapter 4
  await amountInput.fill("20");
  await noteInput.fill("Chapter 4: The Great Migration");
  await saveButton.click();

  await expect(amountInput).toHaveValue("20");
  await expect(noteInput).toHaveValue("Chapter 4: The Great Migration");

  // Edit ONLY amount to 25; do not touch note
  await amountInput.fill("25");
  await saveButton.click();

  // Note survives an amount edit
  await expect(amountInput).toHaveValue("25");
  await expect(noteInput).toHaveValue("Chapter 4: The Great Migration");

  // Reload and confirm both persisted
  await page.reload();
  const reloadedRow = habitsCard(page).locator(`[data-habit="${habit.id}"]`);
  await expect(reloadedRow.getByLabel("Amount for Daily reading")).toHaveValue("25");
  await expect(reloadedRow.getByLabel("Note for Daily reading")).toHaveValue("Chapter 4: The Great Migration");

  // Clear note
  const reloadedNoteInput = reloadedRow.getByLabel("Note for Daily reading");
  await reloadedNoteInput.fill("");
  await reloadedRow.getByRole("button", { name: "Save details" }).click();
  await expect(reloadedNoteInput).toHaveValue("");

  // Reload and confirm note cleared in DB
  await page.reload();
  const reloadedRow2 = habitsCard(page).locator(`[data-habit="${habit.id}"]`);
  await expect(reloadedRow2.getByLabel("Note for Daily reading")).toHaveValue("");
  await expect(reloadedRow2.getByLabel("Amount for Daily reading")).toHaveValue("25");

  // Clear amount (E4)
  const reloadedAmountInput = reloadedRow2.getByLabel("Amount for Daily reading");
  await reloadedAmountInput.fill("");
  await reloadedRow2.getByRole("button", { name: "Save details" }).click();
  await expect(reloadedAmountInput).toHaveValue("");

  // Reload and confirm both amount and note cleared in DB (E4)
  await page.reload();
  const clearedRow = habitsCard(page).locator(`[data-habit="${habit.id}"]`);
  await expect(clearedRow.getByLabel("Amount for Daily reading")).toHaveValue("");
  await expect(clearedRow.getByLabel("Note for Daily reading")).toHaveValue("");
});

test("a pending toggle retry does not collide with a subsequent amount write on the same habit and day", async ({ page }) => {
  const habit = await createHabit(page, "Evening run");

  let toggleMutationId: string | undefined;
  let amountMutationId: string | undefined;
  let checkInCount = 0;

  await page.route("**/api/habits/*/check-in", async (route) => {
    checkInCount += 1;
    const req = route.request();
    const headers = req.headers();
    const mid = headers["x-dayflow-mutation-id"];

    if (checkInCount === 1) {
      // Step 1: Server commits toggle done=true, but client receives 500 so client retains pending mutation ID
      toggleMutationId = mid;
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Network drop on toggle" })
      });
      return;
    }

    if (checkInCount === 2) {
      // Step 2: Amount write with same done=true
      amountMutationId = mid;
      await route.continue();
      return;
    }

    await route.continue();
  });

  await openToday(page);
  const card = habitsCard(page);
  const row = card.locator(`[data-habit="${habit.id}"]`);
  const button = row.getByRole("button", { name: /Evening run: not recorded/ });

  // Step 1: Attempt toggle -> server commits in DB, client receives 500 and retains toggleMutationId
  await button.click();
  const toast = page.locator(".app-error-toast");
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss" }).click();

  // Sync client view with committed server state without reloading the page session
  const taskInput = page.getByPlaceholder("Add a task for today");
  await taskInput.fill("Sync check");
  await taskInput.press("Enter");
  await expect(row.getByRole("button", { name: /Evening run: done/ })).toBeVisible();

  // Step 2: Write amount 5 on recorded habit (same done=true)
  const amountInput = row.getByLabel("Amount for Evening run");
  await expect(amountInput).toBeEnabled();
  await amountInput.fill("5");
  await row.getByRole("button", { name: "Save details" }).click();

  await expect(amountInput).toHaveValue("5");
  expect(checkInCount).toBe(2);
  expect(amountMutationId).toBeTruthy();
  expect(toggleMutationId).toBeTruthy();
  // Under the fix: full payload fingerprint produces distinct mutation key and fresh mutation ID
  expect(amountMutationId).not.toBe(toggleMutationId);
});

test("displays validation error next to amount or note field and keeps user draft", async ({ page }) => {
  const habit = await createHabit(page, "Guitar practice");
  await openToday(page);
  const card = habitsCard(page);

  const row = card.locator(`[data-habit="${habit.id}"]`);
  const amountInput = row.getByLabel("Amount for Guitar practice");
  const noteInput = row.getByLabel("Note for Guitar practice");
  const saveButton = row.getByRole("button", { name: "Save details" });

  // Record today
  await row.getByRole("button", { name: /Guitar practice: not recorded/ }).click();
  await expect(amountInput).toBeEnabled();

  // Invalid amount: negative number
  await amountInput.fill("-5");
  await saveButton.click();

  const amountError = row.locator(".form-error");
  await expect(amountError).toBeVisible();
  await expect(amountError).toContainText("Check-in amount must be a whole number of 0 or more.");
  await expect(amountInput).toHaveValue("-5");

  // Correct amount
  await amountInput.fill("30");
  await saveButton.click();
  await expect(amountError).toHaveCount(0);
  await expect(amountInput).toHaveValue("30");

  // Invalid note: over 2,000 characters
  const overlongNote = "x".repeat(2001);
  await noteInput.fill(overlongNote);
  await saveButton.click();

  const noteError = row.locator(".form-error");
  await expect(noteError).toBeVisible();
  await expect(noteError).toContainText("Check-in note must be 2,000 characters or fewer.");
  await expect(noteInput).toHaveValue(overlongNote);

  // Correct note
  await noteInput.fill("Fingerpicking exercises");
  await saveButton.click();
  await expect(noteError).toHaveCount(0);
  await expect(noteInput).toHaveValue("Fingerpicking exercises");

  // Reload to verify persistence
  await page.reload();
  const reloadedRow = habitsCard(page).locator(`[data-habit="${habit.id}"]`);
  await expect(reloadedRow.getByLabel("Amount for Guitar practice")).toHaveValue("30");
  await expect(reloadedRow.getByLabel("Note for Guitar practice")).toHaveValue("Fingerpicking exercises");
});

test("habits card maintains at least 16px side gutter in phone mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openToday(page);
  const card = habitsCard(page);
  await expect(card).toBeVisible();

  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const leftGutter = box.x;
  const rightGutter = 390 - (box.x + box.width);

  expect(leftGutter).toBeGreaterThanOrEqual(16);
  expect(rightGutter).toBeGreaterThanOrEqual(16);
});

test("habits can be reordered via keyboard with edge disabling, focus retention, live announcement, and persistence across reload", async ({ page }) => {
  const habitA = await createHabit(page, "Habit A");
  const habitB = await createHabit(page, "Habit B");
  const habitC = await createHabit(page, "Habit C");

  await openToday(page);
  const card = habitsCard(page);

  const rowA = card.locator(`[data-habit="${habitA.id}"]`);
  const rowB = card.locator(`[data-habit="${habitB.id}"]`);
  const rowC = card.locator(`[data-habit="${habitC.id}"]`);

  const moveUpA = rowA.getByRole("button", { name: "Move Habit A up" });
  const moveDownA = rowA.getByRole("button", { name: "Move Habit A down" });
  const moveUpB = rowB.getByRole("button", { name: "Move Habit B up" });
  const moveDownB = rowB.getByRole("button", { name: "Move Habit B down" });
  const moveUpC = rowC.getByRole("button", { name: "Move Habit C up" });
  const moveDownC = rowC.getByRole("button", { name: "Move Habit C down" });

  // Initial boundary conditions
  await expect(moveUpA).toBeDisabled();
  await expect(moveDownA).toBeEnabled();
  await expect(moveUpB).toBeEnabled();
  await expect(moveDownB).toBeEnabled();
  await expect(moveUpC).toBeEnabled();
  await expect(moveDownC).toBeDisabled();

  // Focus Move down on Habit A and press Enter
  await moveDownA.focus();
  await expect(moveDownA).toBeFocused();
  await page.keyboard.press("Enter");

  // Live announcement for moving to position 2 of 3
  const announcer = page.locator(".sr-only[role='status']");
  await expect(announcer).toHaveText('Moved "Habit A" to position 2 of 3.');

  // Order is now: B, A, C
  const rows = card.locator(".habit-row-item");
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitA.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitC.id);

  // Focus is retained on Move Habit A down
  await expect(moveDownA).toBeFocused();

  // Move Habit A down again to bottom edge (position 3 of 3)
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText('Moved "Habit A" to position 3 of 3. Now last.');

  // Order is now: B, C, A
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitC.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitA.id);

  // Since Move down on Habit A is now disabled at the bottom edge,
  // focus shifted to Move Habit A up!
  await expect(moveDownA).toBeDisabled();
  await expect(moveUpA).toBeFocused();

  // Move Habit A up to position 2
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText('Moved "Habit A" to position 2 of 3.');
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitA.id);
  await expect(moveUpA).toBeFocused();

  // Move Habit A up to top edge (position 1 of 3)
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText('Moved "Habit A" to position 1 of 3. Now first.');
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitA.id);

  // Since Move up on Habit A is now disabled at top edge, focus shifted to Move Habit A down!
  await expect(moveUpA).toBeDisabled();
  await expect(moveDownA).toBeFocused();

  // Reload page to verify persistence from storage
  await page.reload();
  const reloadedCard = habitsCard(page);
  const reloadedRows = reloadedCard.locator(".habit-row-item");
  await expect(reloadedRows.nth(0)).toHaveAttribute("data-habit", habitA.id);
  await expect(reloadedRows.nth(1)).toHaveAttribute("data-habit", habitB.id);
  await expect(reloadedRows.nth(2)).toHaveAttribute("data-habit", habitC.id);
});

test("rapid duplicate reorder attempts are locked while request is in flight", async ({ page }) => {
  const habitA = await createHabit(page, "Rapid A");
  const habitB = await createHabit(page, "Rapid B");

  await openToday(page);
  const card = habitsCard(page);
  const rowA = card.locator(`[data-habit="${habitA.id}"]`);
  const moveDownA = rowA.getByRole("button", { name: "Move Rapid A down" });

  let patchCount = 0;
  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "PATCH") {
      patchCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await route.continue();
  });

  // Click Move down twice in rapid succession
  await Promise.all([
    moveDownA.click({ force: true }),
    moveDownA.click({ force: true })
  ]);

  const rows = card.locator(".habit-row-item");
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitA.id);

  expect(patchCount).toBe(1);
});

test("confirmed order survives a failed trailing read with read-only retry and uncertain write handling", async ({ page }) => {
  const habitA = await createHabit(page, "Read A");
  const habitB = await createHabit(page, "Read B");

  await openToday(page);
  const card = habitsCard(page);
  const rowA = card.locator(`[data-habit="${habitA.id}"]`);

  let patchCompleted = false;
  let refreshFails = true;
  const retryMethods: string[] = [];

  await page.route("**/api/bootstrap", async (route) => {
    if (patchCompleted && refreshFails) {
      await route.fulfill({
        status: 503,
        json: { error: "Failed to refresh bootstrap", code: "INTERNAL_ERROR" }
      });
      return;
    }
    if (patchCompleted && !refreshFails) {
      retryMethods.push(route.request().method());
    }
    await route.continue();
  });

  page.on("request", (req) => {
    if (patchCompleted && !refreshFails) {
      retryMethods.push(req.method());
    }
  });

  const patchPromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/habits") && resp.request().method() === "PATCH"
  );

  await rowA.getByRole("button", { name: "Move Read A down" }).click();
  const patchResp = await patchPromise;
  expect(patchResp.ok()).toBe(true);
  patchCompleted = true;

  // Confirmed order is retained in UI
  const rows = card.locator(".habit-row-item");
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitA.id);

  // Saved-but-refresh-failed toast appears
  const toast = page.locator(".app-error-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Your change was saved, but Dayflow could not refresh the latest view");

  // Read-only retry button is present
  const retryBtn = toast.getByRole("button", { name: "Retry refresh" });
  await expect(retryBtn).toBeVisible();

  // Clicking Retry refresh performs read-only GET requests, zero write requests
  refreshFails = false;
  retryMethods.length = 0;
  await retryBtn.click();
  await expect(toast).toHaveCount(0);

  // Ensure all methods called during retry were GET (read-only)
  expect(retryMethods.length).toBeGreaterThan(0);
  expect(retryMethods.every((method) => method === "GET")).toBe(true);

  // Verify uncertain write does not claim not-saved or blindly replay
  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        json: { error: "Database unavailable", code: "INTERNAL_ERROR" }
      });
      return;
    }
    await route.continue();
  });

  const rowB = card.locator(`[data-habit="${habitB.id}"]`);
  await rowB.getByRole("button", { name: "Move Read B down" }).click();

  // Uncertain write toast:
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Habit order status unconfirmed. Refresh to check.");
});

test("delayed stale bootstrap arriving after confirmed reorder and check-in cannot undo order or reset check-in", async ({ page }) => {
  const habitA = await createHabit(page, "Stale A");
  const habitB = await createHabit(page, "Stale B");

  let releaseHeldBootstrap!: () => void;
  const heldBootstrapPromise = new Promise<void>((resolve) => {
    releaseHeldBootstrap = resolve;
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("dayflow-first-run-seen", "1");
  });

  let bootstrapCount = 0;
  await page.route("**/api/bootstrap", async (route) => {
    bootstrapCount++;
    if (bootstrapCount === 2) {
      const response = await route.fetch();
      await heldBootstrapPromise;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /(tasks? left|Nothing scheduled yet|All done for today)$/
    })
  ).toBeVisible({ timeout: 30_000 });

  const card = habitsCard(page);
  const rows = card.locator(".habit-row-item");
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitA.id);

  // Reorder habits so habitB is first
  const moveDownA = card.locator(`[data-habit="${habitA.id}"]`).getByRole("button", { name: "Move Stale A down" });
  await moveDownA.click();
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);

  // Also toggle Check-in on habitB
  const toggleB = card.locator(`[data-habit="${habitB.id}"]`).getByRole("button", { name: /Stale B:/ });
  await toggleB.click();
  await expect(toggleB).toContainText("done today");

  // Now release the held old bootstrap response
  releaseHeldBootstrap();
  await page.waitForTimeout(100);

  // Stale bootstrap arriving after confirmed order and check-in does not roll back order or check-in
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitA.id);
  await expect(toggleB).toContainText("done today");
});

test("uncertain reorder retry replaying historical receipt does not project stale order or old announcement", async ({ page }) => {
  const habitA = await createHabit(page, "Retry A");
  const habitB = await createHabit(page, "Retry B");
  const habitC = await createHabit(page, "Retry C");

  await openToday(page);
  const card = habitsCard(page);
  const rows = card.locator(".habit-row-item");

  // Step 1: Start at visible O = [A, B, C]
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitA.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitC.id);

  let patchCount = 0;
  let firstPatchMutationId = "";
  let secondPatchMutationId = "";
  let failTrailingRefresh = false;

  await page.route("**/api/habits", async (route) => {
    if (route.request().method() === "PATCH") {
      patchCount++;
      const mutId = (route.request().headers()["x-dayflow-mutation-id"] as string) ?? "";
      if (patchCount === 1) {
        firstPatchMutationId = mutId;
        // Allow server commit & receipt creation via route.fetch(), then drop the response
        const serverResp = await route.fetch();
        expect(serverResp.status()).toBe(200);
        await route.abort();
        return;
      }
      if (patchCount === 2) {
        secondPatchMutationId = mutId;
        // Deliver server response (receipt replay)
        const serverResp = await route.fetch();
        await route.fulfill({ response: serverResp });
        return;
      }
    }
    await route.continue();
  });

  await page.route("**/api/bootstrap", async (route) => {
    if (failTrailingRefresh) {
      await route.fulfill({
        status: 503,
        json: { error: "Simulated trailing read failure", code: "INTERNAL_ERROR" }
      });
      return;
    }
    await route.continue();
  });

  // Move A down (op X): request commits on server, response is lost
  const rowA = card.locator(`[data-habit="${habitA.id}"]`);
  await rowA.getByRole("button", { name: "Move Retry A down" }).click();

  // Verify UI remains O = [A, B, C]
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitA.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitC.id);
  expect(firstPatchMutationId).toBeTruthy();

  // Step 2: Through real API make a DIFFERENT reorder Y on server without delivering to page
  // Server is currently [B, A, C]. Make reorder Y = [C, B, A]
  const patchY = await page.request.patch("/api/habits", {
    data: {
      ids: [habitC.id, habitB.id, habitA.id],
      expectedIds: [habitB.id, habitA.id, habitC.id]
    },
    headers: {
      "X-Dayflow-Mutation-Id": "server-op-Y-mut"
    }
  });
  expect(patchY.ok()).toBe(true);
  const listAfterY = await (await page.request.get("/api/habits")).json();
  expect(listAfterY.map((h: { id: string }) => h.id)).toEqual([habitC.id, habitB.id, habitA.id]);

  // Step 3: Repeat the same UI move, verify it reuses X's mutation ID and receives X's original receipt. Fail trailing read.
  failTrailingRefresh = true;
  await rowA.getByRole("button", { name: "Move Retry A down" }).click();

  expect(patchCount).toBe(2);
  expect(secondPatchMutationId).toBe(firstPatchMutationId);

  // Step 4: DB must still be Y.
  const dbCheck = await (await page.request.get("/api/habits")).json();
  expect(dbCheck.map((h: { id: string }) => h.id)).toEqual([habitC.id, habitB.id, habitA.id]);

  // UI must NOT publish X's historical order [B, A, C] or announce its old position as current.
  // It must retain O with latest-state-unavailable / read-retry feedback.
  const announcer = page.locator('[aria-live="polite"]');
  await expect(announcer).not.toHaveText(/Moved "Retry A" to position 2 of 3/);
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitA.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitC.id);

  const toast = page.locator(".app-error-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Your change was saved, but Dayflow could not refresh the latest view");
  const retryBtn = toast.getByRole("button", { name: "Retry refresh" });
  await expect(retryBtn).toBeVisible();

  // Step 5: Allow READ-only Retry refresh; UI must then show Y, with zero reorder requests from retry button.
  failTrailingRefresh = false;
  const retryMethods: string[] = [];
  page.on("request", (req) => {
    retryMethods.push(req.method());
  });

  await retryBtn.click();
  await expect(toast).toHaveCount(0);

  // UI now shows Y
  await expect(rows.nth(0)).toHaveAttribute("data-habit", habitC.id);
  await expect(rows.nth(1)).toHaveAttribute("data-habit", habitB.id);
  await expect(rows.nth(2)).toHaveAttribute("data-habit", habitA.id);

  // Ensure zero PATCH requests from retry button
  expect(retryMethods.filter((m) => m === "PATCH").length).toBe(0);
  expect(retryMethods.includes("GET")).toBe(true);
});
