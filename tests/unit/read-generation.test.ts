import assert from "node:assert/strict";
import test from "node:test";
import { loadViewedDay } from "../../src/components/dashboard-api";
import { ApiError } from "../../src/shared/client/api-client";
import { createReadGeneration } from "../../src/shared/client/read-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function viewedDay() {
  const owner = createReadGeneration();
  const state = { title: "original", loading: false, errors: [] as unknown[], finishes: 0 };
  function read(response: Promise<string>) {
    state.loading = true;
    return owner.run(() => response, (title) => { state.title = title; },
      (error) => { state.errors.push(error); },
      () => { state.loading = false; state.finishes++; });
  }
  function edit(title: string) {
    owner.outrank();
    state.title = title;
  }
  return { owner, state, read, edit };
}

for (const operation of ["invalidate", "outrank"] as const) {
  for (const successor of ["success", "failure", "none"] as const) {
    test(`${operation} with ${successor} successor preserves the refresh outcome`, async () => {
      const day = viewedDay();
      const old = deferred<string>();
      const first = day.read(old.promise);
      // Observe both outcomes immediately, including the expected rejections.
      let firstSettled = false;
      const firstOutcome = Promise.allSettled([first]).then((outcomes) => {
        firstSettled = true;
        return outcomes;
      });
      day.owner[operation]();
      day.state.title = operation === "invalidate" ? "confirmed title" : "attempted title";
      const retainedTitle = day.state.title;
      const error = new Error("successor's original failure");
      if (successor !== "none") {
        const newer = deferred<string>();
        const second = day.read(newer.promise);
        const secondOutcome = Promise.allSettled([second]);
        // Allow any premature terminal outcome to propagate while R2 is held.
        for (let turn = 0; turn < 12; turn++) await Promise.resolve();
        assert.equal(firstSettled, false, "R1 must wait for its successor");
        assert.equal(day.state.loading, true);
        assert.equal(day.state.finishes, operation === "outrank" ? 1 : 0);
        if (successor === "failure") newer.reject(error);
        else newer.resolve("newer title");
        assert.deepEqual(await secondOutcome, successor === "failure"
          ? [{ status: "rejected", reason: error }]
          : [{ status: "fulfilled", value: true }]);
      }

      const [outcome] = await firstOutcome;
      if (successor === "failure" || (operation === "invalidate" && successor === "none")) {
        assert.equal(outcome.status, "rejected");
        if (outcome.status === "rejected") {
          if (successor === "failure") assert.equal(outcome.reason, error);
          else assert.equal(outcome.reason.message, "Read invalidated.");
        }
      } else {
        assert.deepEqual(outcome, { status: "fulfilled", value: true });
      }
      assert.equal(day.state.title, successor === "success" ? "newer title" : retainedTitle);
      assert.deepEqual(day.state.errors, successor === "failure" ? [error] : []);
      const finishes = operation === "outrank" && successor !== "none" ? 2 : 1;
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, finishes);
      // The original fetch remains pending until both refresh outcomes settle.
      await complete(old, true);
      assert.equal(day.state.title, successor === "success" ? "newer title" : retainedTitle);
      assert.equal(day.state.finishes, finishes);
      assert.deepEqual(day.state.errors, successor === "failure" ? [error] : []);
    });
  }
}

// Drain the held fetch's handlers, including its finally, without a timer.
async function complete(response: ReturnType<typeof deferred<string>>, failure: boolean) {
  if (failure) response.reject(new Error("abandoned fetch failed"));
  else response.resolve("pre-edit title");
  await response.promise.catch(() => {});
  await Promise.resolve();
  await Promise.resolve();
}

for (const operation of ["invalidate", "outrank"] as const) {
  for (const failure of [false, true]) {
    test(`${operation} waits for successor ${failure ? "failure" : "success"} after the old fetch completes first`, async () => {
      const day = viewedDay();
      const old = deferred<string>();
      const newer = deferred<string>();
      const first = Promise.allSettled([day.read(old.promise)]);
      day.owner[operation]();
      day.state.title = "confirmed title";
      const second = Promise.allSettled([day.read(newer.promise)]);
      await complete(old, failure);
      assert.equal(day.state.title, "confirmed title");
      assert.equal(day.state.loading, true);
      assert.equal(day.state.finishes, operation === "outrank" ? 1 : 0);
      assert.deepEqual(day.state.errors, []);
      const error = new TypeError("successor network error");
      if (failure) newer.reject(error);
      else newer.resolve("newer title");
      const [outcome] = await first;
      assert.deepEqual(await second, [outcome]);
      if (failure) {
        assert.equal(outcome.status, "rejected");
        if (outcome.status === "rejected") assert.equal(outcome.reason, error);
      } else assert.deepEqual(outcome, { status: "fulfilled", value: true });
      assert.equal(day.state.title, failure ? "confirmed title" : "newer title");
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, operation === "outrank" ? 2 : 1);
    });
  }
}

test("repeated invalidations and overlapping successors all follow the final read", async () => {
  const day = viewedDay();
  const old = deferred<string>();
  const middle = deferred<string>();
  const first = Promise.allSettled([day.read(old.promise)]);
  day.owner.invalidate();
  day.owner.invalidate();
  const second = Promise.allSettled([day.read(middle.promise)]);
  day.owner.invalidate();
  const third = day.read(Promise.resolve("final title"));
  assert.equal(await third, true);
  assert.deepEqual(await first, [{ status: "fulfilled", value: true }]);
  assert.deepEqual(await second, [{ status: "fulfilled", value: true }]);
  await complete(old, false);
  await complete(middle, true);
  assert.equal(day.state.title, "final title");
  assert.equal(day.state.finishes, 1);
  assert.deepEqual(day.state.errors, []);
});

for (const firstOperation of ["invalidate", "outrank"] as const) {
  test(`${firstOperation} followed by the other operation retains its terminal outcome`, async () => {
    const day = viewedDay();
    const held = deferred<string>();
    const refresh = Promise.allSettled([day.read(held.promise)]);
    day.owner[firstOperation]();
    day.owner[firstOperation === "invalidate" ? "outrank" : "invalidate"]();
    const [outcome] = await refresh;
    if (firstOperation === "invalidate") {
      assert.equal(outcome.status, "rejected");
      if (outcome.status === "rejected") assert.equal(outcome.reason.message, "Read invalidated.");
    } else assert.deepEqual(outcome, { status: "fulfilled", value: true });
    await complete(held, false);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
  });
}

test("a successor after the invalidation fallback cannot change the settled failure", async () => {
  const day = viewedDay();
  const held = deferred<string>();
  const first = day.read(held.promise);
  day.owner.invalidate();
  await assert.rejects(first, { message: "Read invalidated." });
  assert.equal(await day.read(Promise.resolve("later title")), true);
  await assert.rejects(first, { message: "Read invalidated." });
  await complete(held, true);
  assert.equal(day.state.title, "later title");
  assert.equal(day.state.loading, false);
  assert.equal(day.state.finishes, 2);
});

for (const failure of [false, true]) {
  const result = failure ? "failure" : "success";
  test(`a locally superseded read with fetch ${result} and no successor is a benign refresh`, async () => {
    const day = viewedDay();
    const held = deferred<string>();
    const refresh = day.read(held.promise);
    day.edit("attempted title"); // The save fails; no confirmed response or successor read follows.
    await complete(held, failure);
    assert.equal(await refresh, true);
    assert.equal(day.state.title, "attempted title");
    assert.deepEqual(day.state.errors, []);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
  });

  test(`local supersession settles loading after abandoned fetch ${result}`, async () => {
    const day = viewedDay();
    const held = deferred<string>();
    // Observe rejections here so this test isolates the separate loading defect.
    const refresh = day.read(held.promise).catch(() => false);
    day.edit("attempted title");
    await complete(held, failure);
    await refresh;
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
  });

  for (const oldFirst of [false, true]) {
    test(`local supersession then a newer read publishes only newer data (${result}, old ${oldFirst ? "first" : "last"})`, async () => {
      const day = viewedDay();
      const old = deferred<string>();
      const newer = deferred<string>();
      const first = day.read(old.promise);
      day.edit("attempted title");
      assert.equal(day.state.loading, false);
      const second = day.read(newer.promise);
      if (oldFirst) {
        await complete(old, failure);
        assert.equal(day.state.title, "attempted title");
        assert.equal(day.state.loading, true);
      }
      newer.resolve("newer title");
      assert.deepEqual(await Promise.all([first, second]), [true, true]);
      if (!oldFirst) await complete(old, failure);
      assert.equal(day.state.title, "newer title");
      assert.deepEqual(day.state.errors, []);
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, 2);
    });

    test(`two overlapping reads and two edits settle benignly (${result}, old ${oldFirst ? "first" : "last"})`, async () => {
      const day = viewedDay();
      const a = deferred<string>();
      const b = deferred<string>();
      const first = day.read(a.promise);
      const second = day.read(b.promise);
      const outcomes = Promise.all([first, second]);
      day.edit("first attempt");
      day.edit("second attempt");
      await complete(oldFirst ? a : b, failure);
      await complete(oldFirst ? b : a, failure);
      assert.deepEqual(await outcomes, [true, true]);
      assert.equal(day.state.title, "second attempt");
      assert.deepEqual(day.state.errors, []);
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, 1);
    });
  }

  test(`a confirmed mutation still invalidates its pending read before fetch ${result}`, async () => {
    const day = viewedDay();
    const held = deferred<string>();
    const refresh = day.read(held.promise);
    day.owner.invalidate();
    day.state.title = "confirmed title";
    await assert.rejects(refresh, { message: "Read invalidated." });
    await complete(held, failure);
    assert.equal(day.state.title, "confirmed title");
    assert.deepEqual(day.state.errors, []);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
  });
}

for (const oldFirst of [false, true]) {
  test(`reads interleaved with two edits preserve the last attempted title (old ${oldFirst ? "first" : "last"})`, async () => {
    const day = viewedDay();
    const a = deferred<string>();
    const b = deferred<string>();
    const first = day.read(a.promise);
    day.edit("first attempt");
    const second = day.read(b.promise);
    day.edit("second attempt");
    const outcomes = Promise.all([first, second]);
    await complete(oldFirst ? a : b, false);
    await complete(oldFirst ? b : a, true);
    assert.deepEqual(await outcomes, [true, true]);
    assert.equal(day.state.title, "second attempt");
    assert.deepEqual(day.state.errors, []);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 2);
  });
}

test("local supersession wakes a refresh and settles loading while its fetch is still pending", async () => {
  const day = viewedDay();
  const held = deferred<string>();
  const refresh = day.read(held.promise);
  day.edit("attempted title");
  assert.equal(day.state.loading, false);
  assert.equal(await refresh, true);
  await complete(held, false);
  assert.equal(day.state.finishes, 1);
  assert.equal(day.state.title, "attempted title");
});

test("an edit queued after publication still settles the read and finishes exactly once", async () => {
  const owner = createReadGeneration();
  let finishes = 0;
  const refresh = owner.run(async () => "loaded", () => {
    queueMicrotask(() => owner.outrank());
  }, () => {}, () => finishes++);
  assert.equal(await refresh, true);
  assert.equal(finishes, 1);
  owner.outrank();
  assert.equal(finishes, 1);
});

test("an edit after a completed read does not finish it twice", async () => {
  const day = viewedDay();
  assert.equal(await day.read(Promise.resolve("loaded")), true);
  day.edit("attempted title");
  day.edit("second attempt");
  assert.equal(day.state.finishes, 1);
  assert.equal(day.state.loading, false);
});

for (const failure of ["fetch", "decode"] as const) {
  test(`a genuine ${failure} failure after a confirmed mutation preserves the payload and reaches its caller`, async (t) => {
    const day = viewedDay();
    day.owner.invalidate();
    day.state.title = "confirmed title";
    const networkError = new TypeError("Network unavailable");
    t.mock.method(globalThis, "fetch", async () => {
      if (failure === "fetch") throw networkError;
      return Response.json({ malformed: true });
    });
    const refresh = day.read(loadViewedDay("2026-09-05").then(() => "unexpected payload"));
    await assert.rejects(refresh, (error) => {
      assert.equal(error, day.state.errors[0]);
      if (failure === "fetch") assert.equal(error, networkError);
      else {
        assert.ok(error instanceof ApiError);
        assert.equal(error.kind, "decode");
        assert.equal(error.status, 200);
      }
      return true;
    });
    assert.equal(day.state.title, "confirmed title");
    assert.equal(day.state.errors.length, 1);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
  });
}

for (const failure of [false, true]) {
  test(`superseded read follows newest outcome without waiting for old ${failure ? "error" : "response"}`, async () => {
    const owner = createReadGeneration();
    const a = deferred<string>();
    const b = deferred<string>();
    const published: string[] = [];
    const errors: unknown[] = [];
    let cleanups = 0;
    const first = owner.run(() => a.promise, (v) => published.push(v), (e) => errors.push(e), () => cleanups++);
    const second = owner.run(() => b.promise, (v) => published.push(v), (e) => errors.push(e), () => cleanups++);
    b.resolve("saved");
    assert.equal(await first, true);
    assert.equal(await second, true);
    if (failure) a.reject(new Error("old")); else a.resolve("old");
    await a.promise.catch(() => {});
    await Promise.resolve();
    assert.deepEqual(published, ["saved"]);
    assert.deepEqual(errors, []);
    assert.equal(cleanups, 1);
  });
}

test("a confirmed refresh follows a newer failure instead of reporting success", async () => {
  const owner = createReadGeneration();
  const held = deferred<string>();
  const first = owner.run(() => held.promise, () => {});
  const second = owner.run(() => Promise.reject(new Error("new failure")), () => {});
  await assert.rejects(first, /new failure/);
  await assert.rejects(second, /new failure/);
  held.resolve("old");
});

test("calendar/disposal invalidation wakes callers and suppresses all publication", async () => {
  const owner = createReadGeneration();
  const held = deferred<string>();
  const values: string[] = [];
  const pending = owner.run(() => held.promise, (v) => values.push(v));
  owner.invalidate();
  await assert.rejects(pending, /invalidated/);
  held.resolve("old key");
  await held.promise;
  assert.deepEqual(values, []);
});

for (const operation of ["invalidate", "outrank"] as const) {
  for (const successor of ["success", "failure", "invalidate", "outrank"] as const) {
    test(`three reads across ${operation} follow the final ${successor} outcome`, async () => {
      const day = viewedDay();
      const old = deferred<string>();
      const middle = deferred<string>();
      const newest = deferred<string>();
      const first = Promise.allSettled([day.read(old.promise)]);
      day.owner[operation]();
      const second = Promise.allSettled([day.read(middle.promise)]);
      const third = Promise.allSettled([day.read(newest.promise)]);
      const error = new TypeError("final read failed");
      if (successor === "success") newest.resolve("final title");
      else if (successor === "failure") newest.reject(error);
      else day.owner[successor]();
      const [outcome] = await third;
      assert.deepEqual(await first, [outcome]);
      assert.deepEqual(await second, [outcome]);
      if (successor === "failure" || successor === "invalidate") {
        assert.equal(outcome.status, "rejected");
        if (outcome.status === "rejected") {
          if (successor === "failure") assert.equal(outcome.reason, error);
          else assert.equal(outcome.reason.message, "Read invalidated.");
        }
      } else assert.deepEqual(outcome, { status: "fulfilled", value: true });
      const finishes = operation === "outrank" ? 2 : 1;
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, finishes);
      await complete(old, true);
      await complete(middle, false);
      if (successor === "invalidate" || successor === "outrank") await complete(newest, true);
      assert.equal(day.state.title, successor === "success" ? "final title" : "original");
      assert.deepEqual(day.state.errors, successor === "failure" ? [error] : []);
      assert.equal(day.state.loading, false);
      assert.equal(day.state.finishes, finishes);
    });
  }
}

for (const failure of [false, true]) {
  test(`repeated terminal invalidation finishes once before abandoned fetch ${failure ? "failure" : "success"}`, async () => {
    const day = viewedDay();
    const old = deferred<string>();
    const refresh = day.read(old.promise);
    day.owner.invalidate();
    day.owner.invalidate();
    await assert.rejects(refresh, { message: "Read invalidated." });
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
    day.owner.invalidate();
    day.owner.outrank();
    await complete(old, failure);
    assert.equal(day.state.loading, false);
    assert.equal(day.state.finishes, 1);
    assert.equal(day.state.title, "original");
    assert.deepEqual(day.state.errors, []);
  });
}

test("a successor after local fallback cannot change the settled benign outcome", async () => {
  const day = viewedDay();
  const held = deferred<string>();
  const first = day.read(held.promise);
  day.owner.outrank();
  assert.equal(await first, true);
  const error = new Error("later failure");
  await assert.rejects(day.read(Promise.reject(error)), (actual) => actual === error);
  assert.equal(await first, true);
  await complete(held, true);
  assert.deepEqual(day.state.errors, [error]);
  assert.equal(day.state.loading, false);
  assert.equal(day.state.finishes, 2);
});

test("invalidation queued after publication finishes exactly once", async () => {
  const owner = createReadGeneration();
  let finishes = 0;
  const refresh = owner.run(async () => "loaded", () => {
    queueMicrotask(() => owner.invalidate());
  }, () => {}, () => finishes++);
  await assert.rejects(refresh, { message: "Read invalidated." });
  assert.equal(finishes, 1);
  owner.invalidate();
  await Promise.resolve();
  assert.equal(finishes, 1);
});
