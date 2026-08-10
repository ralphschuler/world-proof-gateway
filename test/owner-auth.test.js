import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerAuth } from "../src/owner-auth.js";
import { MemoryProofStore } from "../src/store.js";

const owner = { appId: "app_gateway", rpId: "rp_gateway", signingKey: `0x${"12".repeat(32)}`, sessionSecret: "a sufficiently long test session secret" };

test("a verified World ID registers a developer account server-side", async () => {
  const store = new MemoryProofStore();
  const auth = createOwnerAuth({ ...owner, store, environment: "staging", now: () => 1_700_000_000_000, fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "gateway-owner-login-v1", environment: "staging", nullifier: "0x123" }), { status: 200 }) });
  const context = await auth.proofContext();
  assert.equal(context.status, 200);
  const proof = (nonce) => ({ idkitResponse: { nonce, action: "gateway-owner-login-v1", environment: "staging" } });
  const login = await auth.verify(proof(context.body.rp_context.nonce));
  assert.equal(login.status, 200);
  assert.equal(auth.session(login.body.session), "291");
  assert.equal(await store.isOwnerEnrolled("291"), true);
});
