import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createGateway } from "../src/gateway.js";
import { createHttpHandler } from "../src/http-app.js";
import { MemoryProofStore } from "../src/store.js";

async function withApp(run) {
  const store = new MemoryProofStore();
  const gateway = createGateway({ projects: new Map(), store, fetchImpl: async () => { throw new Error("must_not_call_world"); } });
  const server = createServer(createHttpHandler({ gateway, store, demoMode: true }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, store); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("demo mode serves labeled onboarding and a healthy non-verifying path", async () => {
  await withApp(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /DEMO — no real proof verification or crediting/);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.deepEqual(health, { ok: true, mode: "demo" });
    const blocked = await (await fetch(`${base}/v1/projects/demo/proofs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.deepEqual(blocked, { error: "demo_mode_real_proofs_disabled", demo: true });
  });
});

test("billing is read-only and support intake is explicitly non-durable", async () => {
  await withApp(async (base, store) => {
    const plan = await (await fetch(`${base}/v1/billing/plan`)).json();
    assert.equal(plan.charging_enabled, false);
    assert.equal(plan.wld_billing_ready, false);
    const response = await fetch(`${base}/v1/support-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "beta@example.test", message: "Please send setup details." }) });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).non_production_storage, true);
    const saved = await store.listSupportRequests();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].email, "beta@example.test");
    assert.equal(saved[0].message, "Please send setup details.");
    assert.match(saved[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});
