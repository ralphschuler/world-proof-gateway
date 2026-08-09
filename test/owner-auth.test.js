import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerAuth } from "../src/owner-auth.js";
import { MemoryProofStore } from "../src/store.js";

const owner = { appId: "app_gateway", rpId: "rp_gateway", signingKey: `0x${"12".repeat(32)}`, sessionSecret: "a sufficiently long test session secret" };

test("an unbootstrapped verified person is denied, while explicit bootstrap persists enrollment", async () => {
  const store = new MemoryProofStore();
  const auth = createOwnerAuth({ ...owner, store, environment: "staging", now: () => 1_700_000_000_000, fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "gateway-owner-login-v1", environment: "staging", nullifier: "0x123" }), { status: 200 }) });
  const context = await auth.proofContext();
  assert.equal(context.status, 200);
  const proof = (nonce) => ({ idkitResponse: { nonce, action: "gateway-owner-login-v1", environment: "staging" } });
  assert.deepEqual(await auth.verify(proof(context.body.rp_context.nonce)), { status: 403, body: { error: "owner_not_enrolled" } });
  const bootstrapContext = await auth.proofContext();
  const bootstrapped = await auth.verify({ ...proof(bootstrapContext.body.rp_context.nonce), bootstrap: true });
  assert.equal(bootstrapped.status, 200);
  assert.equal(auth.session(bootstrapped.body.session), "291");
  const loginContext = await auth.proofContext();
  assert.equal((await auth.verify(proof(loginContext.body.rp_context.nonce))).status, 200);
  const duplicateContext = await auth.proofContext();
  assert.equal((await auth.verify({ ...proof(duplicateContext.body.rp_context.nonce), bootstrap: true })).status, 409);
});
