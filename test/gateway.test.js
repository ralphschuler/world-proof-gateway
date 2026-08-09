import test from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../src/gateway.js";
import { MemoryProofStore } from "../src/store.js";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

const key = `0x${"11".repeat(32)}`;
const projects = new Map([["demo", { id: "demo", appId: "app_demo", rpId: "rp_demo", action: "demo-access-v1", environment: "staging", signingKey: key, allowedOrigins: ["https://example.test"], signalPolicy: "none" }]]);
test("fixed project config creates a signed RP context", async () => {
  const gateway = createGateway({ projects, store: new MemoryProofStore(), fetchImpl: fetch });
  const result = await gateway.proofContext("demo", { action: "demo-access-v1" }, "https://example.test");
  assert.equal(result.status, 200); assert.equal(result.body.app_id, "app_demo"); assert.match(result.body.rp_context.rp_id, /^rp_/); assert.ok(result.body.rp_context.signature);
});
test("caller cannot select an arbitrary action or origin", async () => {
  const gateway = createGateway({ projects, store: new MemoryProofStore(), fetchImpl: fetch });
  assert.equal((await gateway.proofContext("demo", { action: "other-action" }, "https://example.test")).status, 400);
  assert.equal((await gateway.proofContext("demo", { action: "demo-access-v1" }, "https://evil.test")).status, 403);
});
test("a verified wallet-bound proof produces a short-lived contract attestation", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const onchainProject = new Map([["chain-demo", {
    id: "chain-demo", appId: "app_chain", rpId: "rp_chain", action: "chain-access-v1", environment: "staging", signingKey: key,
    allowedOrigins: ["https://example.test"], signalPolicy: "wallet-address",
    attestation: { chainId: 480, verifyingContract: "0x2222222222222222222222222222222222222222", ttlSeconds: 300 },
  }]]);
  const gateway = createGateway({ projects: onchainProject, store: new MemoryProofStore(), attestationKey: `0x${"22".repeat(32)}`, now: () => 1_700_000_000_000,
    fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "chain-access-v1", environment: "staging", nullifier: "0x42" }), { status: 200 }),
  });
  const context = await gateway.proofContext("chain-demo", { action: "chain-access-v1", signal: wallet }, "https://example.test");
  const proof = { nonce: context.body.rp_context.nonce, action: "chain-access-v1", environment: "staging", responses: [{ signal_hash: hashSignal(wallet) }] };
  const result = await gateway.verify("chain-demo", { idkitResponse: proof }, "https://example.test");
  assert.equal(result.status, 200); assert.equal(result.body.attestation.payload.subject, wallet); assert.equal(result.body.attestation.payload.deadline, 1_700_000_300); assert.match(result.body.attestation.signature, /^0x[0-9a-f]+$/);
});
