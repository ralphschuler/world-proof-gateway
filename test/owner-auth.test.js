import test from "node:test";
import assert from "node:assert/strict";
import { configuredOwnerNullifiers, createOwnerAuth, enrollConfiguredOwners } from "../src/owner-auth.js";
import { MemoryProofStore } from "../src/store.js";

const owner = { appId: "app_gateway", rpId: "rp_gateway", signingKey: `0x${"12".repeat(32)}`, sessionSecret: "a sufficiently long test session secret" };

test("configured owner nullifiers are normalized and enrolled server-side", async () => {
  const store = new MemoryProofStore();
  assert.deepEqual(configuredOwnerNullifiers("0x123, 291,0x123"), ["291"]);
  assert.deepEqual(configuredOwnerNullifiers(), []);
  assert.throws(() => configuredOwnerNullifiers("not-a-nullifier"), /invalid_gateway_owner_nullifier/);
  assert.throws(() => configuredOwnerNullifiers("0"), /invalid_gateway_owner_nullifier/);
  await enrollConfiguredOwners(store, "0x123");
  const auth = createOwnerAuth({ ...owner, store, ownerNullifiers: configuredOwnerNullifiers("0x123"), environment: "staging", now: () => 1_700_000_000_000, fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "gateway-owner-login-v1", environment: "staging", nullifier: "0x123" }), { status: 200 }) });
  const context = await auth.proofContext();
  assert.equal(context.status, 200);
  const proof = (nonce) => ({ idkitResponse: { nonce, action: "gateway-owner-login-v1", environment: "staging" } });
  const login = await auth.verify(proof(context.body.rp_context.nonce));
  assert.equal(login.status, 200);
  assert.equal(auth.session(login.body.session), "291");
  const revoked = createOwnerAuth({ ...owner, store, ownerNullifiers: [], environment: "staging", now: () => 1_700_000_000_000, fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "gateway-owner-login-v1", environment: "staging", nullifier: "0x123" }), { status: 200 }) });
  const revokedContext = await revoked.proofContext();
  assert.deepEqual(await revoked.verify(proof(revokedContext.body.rp_context.nonce)), { status: 403, body: { error: "owner_not_enrolled" } });
});
