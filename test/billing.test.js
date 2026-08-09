import test from "node:test";
import assert from "node:assert/strict";
import { createBillingService, WLD_REQUEST_PACK } from "../src/billing.js";
import { MemoryProofStore } from "../src/store.js";

const receiver = "0x1111111111111111111111111111111111111111";
const appId = "app_gateway";
const apiKey = "this-is-a-server-only-developer-api-key";

test("one mined exact WLD payment credits exactly 5,000 requests once", async () => {
  const store = new MemoryProofStore();
  let requested;
  let reference;
  const billing = createBillingService({
    store, receiverAddress: receiver, appId, developerApiKey: apiKey,
    fetchImpl: async (url) => { requested = url; return new Response(JSON.stringify({ transaction_status: "mined", reference, app_id: appId, chain: "worldchain", token: "WLD", token_amount: WLD_REQUEST_PACK.priceAtomic, to: receiver, transaction_hash: "0xhash" }), { status: 200 }); },
  });
  const intent = await billing.createIntent({ projectId: "idle-mint" });
  assert.equal(intent.status, 201);
  reference = intent.body.reference;
  const confirm = await billing.confirmPayment({ reference, transactionId: "tx_123" });
  assert.equal(confirm.status, 200);
  assert.deepEqual(confirm.body, { credited: true, project_id: "idle-mint", request_credits: 5000, remaining_requests: 5000 });
  assert.match(requested, /type=payment/);
  const retry = await billing.confirmPayment({ reference, transactionId: "tx_123" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.idempotent, true);
});

test("billing rejects a payment that does not exactly match the order", async () => {
  const store = new MemoryProofStore();
  const billing = createBillingService({
    store, receiverAddress: receiver, appId, developerApiKey: apiKey,
    fetchImpl: async () => new Response(JSON.stringify({ transaction_status: "mined", reference: "wrong", app_id: appId, chain: "worldchain", token: "WLD", token_amount: WLD_REQUEST_PACK.priceAtomic, to: receiver }), { status: 200 }),
  });
  const intent = await billing.createIntent({ projectId: "idle-mint" });
  const confirmation = await billing.confirmPayment({ reference: intent.body.reference, transactionId: "tx_234" });
  assert.equal(confirmation.status, 422);
  assert.deepEqual(confirmation.body, { error: "world_payment_mismatch" });
});
