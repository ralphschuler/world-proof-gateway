import { createHmac, timingSafeEqual } from "node:crypto";
import { signRequest } from "@worldcoin/idkit-core/signing";

function json(status, body) { return { status, body }; }
function hex(value) { try { return BigInt(value).toString(10); } catch { return null; } }

export function createOwnerAuth({ store, appId, rpId, signingKey, environment = "production", action = "gateway-owner-login-v1", sessionSecret, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  if (!store || !/^app_[A-Za-z0-9]+$/.test(appId || "") || !/^rp_[A-Za-z0-9]+$/.test(rpId || "") || !signingKey || !sessionSecret) throw new Error("owner_auth_configuration_required");
  const mac = (value) => createHmac("sha256", sessionSecret).update(value).digest("base64url");
  const encode = (owner) => {
    const payload = Buffer.from(JSON.stringify({ owner, exp: Math.floor(now() / 1000) + 60 * 60 * 8 })).toString("base64url");
    return `${payload}.${mac(payload)}`;
  };
  function session(token) {
    const [payload, signature, ...extra] = String(token || "").split(".");
    if (!payload || !signature || extra.length || signature.length !== mac(payload).length || !timingSafeEqual(Buffer.from(signature), Buffer.from(mac(payload)))) return null;
    try { const value = JSON.parse(Buffer.from(payload, "base64url").toString()); return typeof value.owner === "string" && value.exp > Math.floor(now() / 1000) ? value.owner : null; } catch { return null; }
  }
  async function proofContext() {
    const request = signRequest({ action, signingKeyHex: signingKey });
    await store.saveOwnerContext({ nonce: request.nonce, action, expiresAt: Number(request.expiresAt) * 1000 });
    return json(200, { app_id: appId, action, environment, rp_context: { rp_id: rpId, nonce: request.nonce, created_at: request.createdAt, expires_at: request.expiresAt, signature: request.sig } });
  }
  async function verify({ idkitResponse, bootstrap = false } = {}) {
    if (!idkitResponse || typeof idkitResponse.nonce !== "string" || idkitResponse.action !== action || idkitResponse.environment !== environment) return json(400, { error: "invalid_proof_shape" });
    const context = await store.consumeOwnerContext(idkitResponse.nonce);
    if (!context || context.action !== action) return json(409, { error: "expired_or_replayed_context" });
    let response; try { response = await fetchImpl(`https://developer.world.org/api/v4/verify/${rpId}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "world-proof-gateway/0.1" }, body: JSON.stringify(idkitResponse) }); } catch { return json(502, { error: "world_verify_unavailable" }); }
    let verified; try { verified = await response.json(); } catch { return json(502, { error: "world_verify_invalid_response" }); }
    const nullifier = hex(verified?.nullifier);
    if (!response.ok || verified?.success !== true || verified.action !== action || verified.environment !== environment || !nullifier) return json(422, { error: "world_proof_rejected" });
    if (bootstrap) {
      if (!(await store.enrollOwnerNullifier(nullifier))) return json(409, { error: "owner_already_enrolled" });
    } else {
      if (!(await store.isOwnerEnrolled(nullifier))) return json(403, { error: "owner_not_enrolled" });
      await store.recordOwnerLogin(nullifier);
    }
    return json(200, { verified: true, session: encode(nullifier) });
  }
  return { proofContext, verify, session };
}
