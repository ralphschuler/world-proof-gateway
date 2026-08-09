import { onboardingPage, betaBillingPlan } from "./onboarding.js";
import { timingSafeEqual } from "node:crypto";

function reply(res, status, body, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) { headers["access-control-allow-origin"] = origin; headers.vary = "Origin"; }
  res.writeHead(status, headers); res.end(JSON.stringify(body));
}
function html(res, content) { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(content); }
async function body(req) {
  let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error("body_too_large"); }
  return raw ? JSON.parse(raw) : {};
}
function validSupportRequest({ email, message } = {}) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && typeof message === "string" && message.trim().length > 0 && message.length <= 2000;
}
function authorized(req, token) {
  const supplied = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token || !supplied || supplied.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

export function createHttpHandler({ gateway, store, demoMode = false, tenantRegistry = null, adminToken = null }) {
  if (!gateway || !store) throw new Error("http_dependencies_required");
  return async (req, res) => {
    const origin = req.headers.origin;
    if (req.method === "GET" && req.url === "/") return html(res, onboardingPage({ demoMode }));
    if (req.method === "GET" && req.url === "/healthz") {
      try { await store.health(); return reply(res, 200, { ok: true, mode: demoMode ? "demo" : "production" }); }
      catch { return reply(res, 503, { ok: false, error: "store_unavailable" }); }
    }
    if (req.method === "GET" && req.url === "/v1/billing/plan") return reply(res, 200, betaBillingPlan, origin);
    if (req.url === "/v1/admin/tenants") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
      if (demoMode || !tenantRegistry) return reply(res, 503, { error: "tenant_admin_unavailable" });
      if (!authorized(req, adminToken)) return reply(res, 401, { error: "unauthorized" });
      try { return reply(res, 201, { tenant: await tenantRegistry.create(await body(req)) }); }
      catch { return reply(res, 400, { error: "tenant_create_failed" }); }
    }
    if (req.url === "/v1/support-requests") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" }, origin);
      try {
        const request = await body(req);
        if (!validSupportRequest(request)) return reply(res, 400, { error: "invalid_support_request" }, origin);
        if (typeof store.saveSupportRequest !== "function") return reply(res, 503, { error: "support_storage_not_configured", message: "Support intake is unavailable until a durable schema is configured." }, origin);
        await store.saveSupportRequest({ email: request.email, message: request.message.trim(), createdAt: new Date().toISOString() });
        return reply(res, 202, { accepted: true, non_production_storage: true, message: "Demo support request stored in non-durable memory only." }, origin);
      } catch { return reply(res, 400, { error: "invalid_json" }, origin); }
    }
    const match = req.url?.match(/^\/v1\/projects\/([a-z0-9-]{3,48})\/(proof-context|proofs)$/);
    if (!match) return reply(res, 404, { error: "not_found" });
    if (req.method === "OPTIONS") return reply(res, 204, {}, origin);
    if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" }, origin);
    if (demoMode) return reply(res, 503, { error: "demo_mode_real_proofs_disabled", demo: true }, origin);
    try {
      const result = match[2] === "proof-context" ? await gateway.proofContext(match[1], await body(req), origin) : await gateway.verify(match[1], await body(req), origin);
      return reply(res, result.status, result.body, origin);
    } catch { return reply(res, 400, { error: "invalid_json" }, origin); }
  };
}
