import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createGateway } from "../src/gateway.js";
import { createHttpHandler } from "../src/http-app.js";
import { MemoryProofStore } from "../src/store.js";
import { createOwnerAuth } from "../src/owner-auth.js";

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
    const idkit = await fetch(`${base}/assets/idkit.global.js`);
    assert.equal(idkit.status, 200);
    assert.match(idkit.headers.get("content-type"), /text\/javascript/);
    const wasm = await fetch(`${base}/assets/idkit_wasm_bg.wasm`);
    assert.equal(wasm.status, 200);
    assert.match(wasm.headers.get("content-type"), /application\/wasm/);
    const minikit = await fetch(`${base}/assets/minikit.js`);
    assert.equal(minikit.status, 200);
    assert.match(minikit.headers.get("content-type"), /text\/javascript/);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.deepEqual(health, { ok: true, mode: "demo" });
    const blocked = await (await fetch(`${base}/v1/projects/demo/proofs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.deepEqual(blocked, { error: "demo_mode_real_proofs_disabled", demo: true });
  });
});

test("a verified user owns their projects, browser bootstrap is unavailable, and Portal-issued RP keys are never returned", async () => {
  const store = new MemoryProofStore();
  const ownerAuth = createOwnerAuth({ store, appId: "app_gateway", rpId: "rp_gateway", signingKey: `0x${"12".repeat(32)}`, sessionSecret: "test session secret with enough entropy", environment: "staging", fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "gateway-owner-login-v1", environment: "staging", nullifier: "0x99" })) });
  const records = [];
  const registry = { async listForOwner(id) { return records.filter((p) => p.owner === id).map(({ owner, ...p }) => p); }, async createForOwner(id, input) { const tenant = { ...input, owner: id, status: "active" }; records.push(tenant); return tenant; } };
  const gateway = createGateway({ projects: new Map(), store });
  const server = createServer(createHttpHandler({ gateway, store, tenantRegistry: registry, ownerAuth }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Developer console/);
    assert.equal((await fetch(`${base}/v1/owner/projects`)).status, 401);
    const context = await (await fetch(`${base}/v1/owner/proof-context`, { method: "POST" })).json();
    const login = await fetch(`${base}/v1/owner/proofs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idkitResponse: { nonce: context.rp_context.nonce, action: context.action, environment: context.environment } }) });
    assert.equal(login.status, 200);
    assert.equal((await fetch(`${base}/v1/admin/owner/proof-context`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/v1/admin/tenants`, { method: "POST" })).status, 404);
    const session = login.headers.get("set-cookie");
    assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
    const insecureCreate = await fetch(`${base}/v1/owner/projects`, { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: "{}" });
    assert.deepEqual(await insecureCreate.json(), { error: "https_required" });
    const created = await fetch(`${base}/v1/owner/projects`, { method: "POST", headers: { cookie: session, "content-type": "application/json", "x-forwarded-proto": "https" }, body: JSON.stringify({ id: "owner-project", appId: "app_owner", rpId: "rp_owner", rpSigningKey: `0x${"34".repeat(32)}`, action: "owner-project-access", environment: "staging", allowedOrigins: ["https://example.test"], signalPolicy: "none" }) });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.rp_signing_key, undefined);
    assert.doesNotMatch(JSON.stringify(createdBody), /0x343434/);
    const listed = await (await fetch(`${base}/v1/owner/projects`, { headers: { cookie: session } })).json();
    assert.equal(listed.projects.length, 1);
    assert.doesNotMatch(JSON.stringify(listed), /rpSigningKey|0x343434/);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
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
