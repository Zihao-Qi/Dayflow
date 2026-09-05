"use client";

/** A read owner's ordering only: no values, keys, cache or resource map. */
export function createReadGeneration() {
  const generation = { current: 0 };
  type Outcome = { ok: true } | { ok: false; error: unknown };
  let latest: Promise<Outcome> | null = null;
  let supersede: (() => void) | null = null;

  function invalidate() {
    generation.current += 1;
    latest = null;
    supersede?.();
    supersede = null;
  }

  /** A local edit outranks older reads without making them report a failure. */
  function outrank() {
    generation.current += 1;
  }

  async function run<T>(
    fetch: () => Promise<T>,
    publish: (value: T) => void,
    fail: (error: unknown) => void = () => {},
    finish: () => void = () => {}
  ): Promise<boolean> {
    const previous = supersede;
    let wake!: () => void;
    const replaced = new Promise<null>((resolve) => {
      wake = () => resolve(null);
    });
    supersede = wake;
    const ticket = ++generation.current;
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
      if (ticket === generation.current) finish();
    });
    const outcome: Promise<Outcome> = Promise.race([response, replaced]).then(
      (result) => ticket === generation.current && result
        ? result
        : latest ?? { ok: false, error: new Error("Read invalidated.") }
    );
    latest = outcome;
    previous?.();
    const result = await outcome;
    if (!result.ok) throw result.error;
    return true;
  }

  return { run, invalidate, outrank };
}
