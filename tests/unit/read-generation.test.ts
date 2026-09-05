import assert from "node:assert/strict";
import test from "node:test";
import { createReadGeneration } from "../../src/shared/client/read-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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
