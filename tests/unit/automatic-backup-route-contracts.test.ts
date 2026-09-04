import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PUT as saveAutomaticPolicy } from "../../src/app/api/backups/automatic/route";

const localActionHeaders = {
  "Content-Type": "application/json",
  "Host": "127.0.0.1",
  "Origin": "http://127.0.0.1",
  "X-Dayflow-Local-Action": "1"
};

function policyRequest(body: string, headers = localActionHeaders) {
  return new NextRequest("http://127.0.0.1/api/backups/automatic", {
    method: "PUT",
    headers,
    body
  });
}

test("automatic backup settings require the local-action guard", async () => {
  const response = await saveAutomaticPolicy(
    policyRequest(JSON.stringify({ enabled: true }), {
      "Content-Type": "application/json"
    } as typeof localActionHeaders)
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
});

test("automatic backup settings reject malformed JSON before touching disk", async () => {
  const response = await saveAutomaticPolicy(policyRequest("{"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_JSON");
});

test("automatic backup settings return typed field errors", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ intervalHours: 24, retainCount: 7 }, "enabled"],
    [{ enabled: "yes", intervalHours: 24, retainCount: 7 }, "enabled"],
    [{ enabled: true, intervalHours: 0, retainCount: 7 }, "intervalHours"],
    [{ enabled: true, intervalHours: 24, retainCount: 0 }, "retainCount"],
    [{ enabled: true, intervalHours: 24, retainCount: 7, extra: 1 }, "policy"]
  ];

  for (const [body, field] of cases) {
    const response = await saveAutomaticPolicy(
      policyRequest(JSON.stringify(body))
    );
    const payload = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(payload.code, "VALIDATION_ERROR", JSON.stringify(body));
    assert.equal(payload.field, field, JSON.stringify(body));
    assert.ok(
      !/sqlite|prisma|\/Users\//i.test(payload.error),
      "policy errors must not leak internals"
    );
  }
});

test("automatic backup policy errors preserve their exact envelope", async () => {
  const response = await saveAutomaticPolicy(
    policyRequest(
      JSON.stringify({ enabled: true, intervalHours: 0, retainCount: 7 })
    )
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "The backup interval in hours must be a whole number between 1 and 168.",
    code: "VALIDATION_ERROR",
    field: "intervalHours"
  });
});
