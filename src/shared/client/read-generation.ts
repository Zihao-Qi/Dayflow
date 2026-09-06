"use client";

/** A read owner's ordering only: no values, keys, cache or resource map. */
export function createReadGeneration() {
  const generation = { current: 0 };
  type Outcome = { ok: true } | { ok: false; error: unknown };
  type Replace = (outcome: Outcome | Promise<Outcome>) => void;
  let supersede: Replace | null = null;
  let abandoned: Replace | null = null;
  let finishCurrent: (() => void) | null = null;

  function abandon(fallback: Outcome, finishImmediately: boolean) {
    generation.current += 1;
    const pending = supersede;
    const finish = finishCurrent;
    supersede = null;
    finishCurrent = null;
    if (pending) {
      abandoned = pending;
      // Either operation can be followed by an immediate successor. Only a
      // terminal abandonment may finish here; a successor owns its loading.
      queueMicrotask(() => {
        if (abandoned !== pending) return;
        abandoned = null;
        pending(fallback);
        if (!finishImmediately) finish?.();
      });
    }
    if (finishImmediately) finish?.();
  }

  function invalidate() {
    abandon({ ok: false, error: new Error("Read invalidated.") }, false);
  }

  /** A local edit settles benignly unless an immediate successor supplies its outcome. */
  function outrank() {
    abandon({ ok: true }, true);
  }

  async function run<T>(
    fetch: () => Promise<T>,
    publish: (value: T) => void,
    fail: (error: unknown) => void = () => {},
    finish: () => void = () => {}
  ): Promise<boolean> {
    const previous = supersede ?? abandoned;
    abandoned = null;
    const replaced = new Promise<Outcome>((resolve) => {
      supersede = resolve;
    });
    const ticket = ++generation.current;
    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      finish();
    };
    finishCurrent = finishOnce;
    const response = fetch().then<Outcome, Outcome>(
      (value) => {
        if (ticket === generation.current) publish(value);
        return { ok: true };
      },
      (error: unknown) => {
        if (ticket === generation.current) fail(error);
        return { ok: false, error };
      }
    ).finally(() => {
      if (ticket === generation.current) finishOnce();
    });
    // A stale read follows its explicit replacement: a terminal outcome or a
    // strictly newer read. It never looks up (and cannot adopt) its own outcome.
    const outcome: Promise<Outcome> = Promise.race([response, replaced]).then(
      (result) => ticket === generation.current ? result : replaced
    );
    previous?.(outcome);
    const result = await outcome;
    if (!result.ok) throw result.error;
    return true;
  }

  return { run, invalidate, outrank };
}
