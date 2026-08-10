import { randomUUID } from "node:crypto";

export const WLD_REQUEST_PACK = Object.freeze({
  id: "wld-5000-requests-v1",
  currency: "WLD",
  // MiniKit Pay receives the WLD 18-decimal amount; the Developer Portal
  // transaction API returns the verified amount with six decimals.
  payAmount: "1000000000000000000",
  priceAtomic: "1000000",
  displayPrice: "1 WLD",
  requestCredits: 5000,
});

const address = /^0x[a-fA-F0-9]{40}$/;

function paymentReady({ receiverAddress, appId, developerApiKey }) {
  return address.test(receiverAddress || "") && /^app_[A-Za-z0-9]+$/.test(appId || "") && typeof developerApiKey === "string" && developerApiKey.length > 20;
}

export function billingPlan({ receiverAddress, appId, developerApiKey } = {}) {
  const ready = paymentReady({ receiverAddress, appId, developerApiKey });
  return {
    ...WLD_REQUEST_PACK,
    mode: ready ? "live" : "configuration_required",
    charging_enabled: ready,
    wld_billing_ready: ready,
    message: ready ? "1 WLD buys 5,000 verified-proof requests." : "WLD checkout is configured at 1 WLD for 5,000 requests and awaits the server-side World credentials.",
  };
}

export function createBillingService({ store, receiverAddress, appId, developerApiKey, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  if (!store || typeof fetchImpl !== "function") throw new Error("billing_dependencies_required");
  const plan = billingPlan({ receiverAddress, appId, developerApiKey });
  async function createIntent({ projectId } = {}) {
    if (!plan.charging_enabled) return { status: 503, body: { error: "billing_not_configured" } };
    if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(projectId || "")) return { status: 400, body: { error: "invalid_project_id" } };
    const reference = `wpg_${randomUUID().replaceAll("-", "")}`;
    await store.createBillingOrder({ reference, projectId, priceAtomic: plan.priceAtomic, requestCredits: plan.requestCredits, expiresAt: new Date(now() + 15 * 60_000).toISOString() });
    return { status: 201, body: { reference, project_id: projectId, to: receiverAddress, token: plan.currency, token_amount: plan.payAmount, description: "World Proof Gateway — 5,000 requests", expires_at: new Date(now() + 15 * 60_000).toISOString() } };
  }
  async function confirmPayment({ reference, transactionId } = {}) {
    if (!plan.charging_enabled) return { status: 503, body: { error: "billing_not_configured" } };
    if (typeof reference !== "string" || !/^wpg_[a-f0-9]{32}$/.test(reference) || typeof transactionId !== "string" || transactionId.length > 200) return { status: 400, body: { error: "invalid_payment_confirmation" } };
    const order = await store.getBillingOrder(reference);
    if (!order) return { status: 404, body: { error: "unknown_payment_reference" } };
    if (order.status === "credited") return { status: 200, body: { credited: true, project_id: order.projectId, request_credits: order.requestCredits, idempotent: true } };
    if (Date.parse(order.expiresAt) <= now()) return { status: 409, body: { error: "payment_reference_expired" } };
    let response;
    try {
      response = await fetchImpl(`https://developer.world.org/api/v2/minikit/transaction/${encodeURIComponent(transactionId)}?app_id=${encodeURIComponent(appId)}&type=payment`, { headers: { authorization: `Bearer ${developerApiKey}`, "user-agent": "world-proof-gateway/0.1" } });
    } catch { return { status: 502, body: { error: "world_payment_verify_unavailable" } }; }
    let transaction; try { transaction = await response.json(); } catch { return { status: 502, body: { error: "world_payment_verify_invalid_response" } }; }
    if (!response.ok) return { status: 422, body: { error: "world_payment_not_accepted" } };
    const valid = transaction?.transaction_status === "mined"
      && transaction.reference === reference
      && transaction.app_id === appId
      && transaction.chain === "worldchain"
      && String(transaction.token || "").toUpperCase() === "WLD"
      && String(transaction.token_amount) === plan.priceAtomic
      && String(transaction.to || "").toLowerCase() === receiverAddress.toLowerCase();
    if (!valid) return { status: 422, body: { error: "world_payment_mismatch" } };
    const credited = await store.creditBillingOrder({ reference, transactionId, transactionHash: transaction.transaction_hash || null });
    if (!credited) return { status: 409, body: { error: "payment_already_claimed" } };
    return { status: 200, body: { credited: true, project_id: order.projectId, request_credits: order.requestCredits, remaining_requests: credited.remainingRequests } };
  }
  return { plan, createIntent, confirmPayment };
}
