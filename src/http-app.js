import { onboardingPage } from "./onboarding.js";
import { dashboardPage } from "./dashboard.js";
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const idkitAssetDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@worldcoin", "idkit-core", "dist");
const browserAssetDirectory = join(dirname(fileURLToPath(import.meta.url)), "static");
const idkitAssets = {
  "/assets/idkit.global.js": { file: "idkit.global.js", type: "text/javascript; charset=utf-8" },
  "/assets/idkit_wasm_bg.wasm": { file: "idkit_wasm_bg.wasm", type: "application/wasm" },
};

function reply(res, status, body, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) { headers["access-control-allow-origin"] = origin; headers.vary = "Origin"; }
  res.writeHead(status, headers); res.end(JSON.stringify(body));
}
function html(res, content) { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(content); }
function asset(res, definition) {
  res.writeHead(200, { "content-type": definition.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
  createReadStream(join(idkitAssetDirectory, definition.file)).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
}
function browserAsset(res, file) {
  res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
  createReadStream(join(browserAssetDirectory, file)).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
}
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
function secureRequest(req) { return req.socket.encrypted === true || req.headers["x-forwarded-proto"] === "https"; }
function publicTenant(tenant) {
  const { rpSigningKey, signingKey, signing_key_envelope, ...safe } = tenant || {};
  return safe;
}
function cookie(req, name) { return req.headers.cookie?.split(/;\s*/).find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1); }
function ownerCookie(value) { return `wpg_owner_session=${value}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`; }

export function createHttpHandler({ gateway, store, demoMode = false, tenantRegistry = null, adminToken = null, billing = null, ownerAuth = null }) {
  if (!gateway || !store) throw new Error("http_dependencies_required");
  return async (req, res) => {
    const origin = req.headers.origin;
    if (req.method === "GET" && idkitAssets[req.url]) return asset(res, idkitAssets[req.url]);
    if (req.method === "GET" && req.url === "/assets/minikit.js") return browserAsset(res, "minikit.js");
    // The World Developer Portal opens the registered app URL at its origin.
    // Production therefore needs the owner console at `/`, not a separate
    // marketing/checkout page that assumes a project already exists.
    if (req.method === "GET" && req.url === "/") return html(res, demoMode ? onboardingPage({ demoMode, billingPlan: billing?.plan }) : dashboardPage());
    if (req.method === "GET" && req.url === "/dashboard") return html(res, dashboardPage());
    if (req.method === "GET" && req.url === "/healthz") {
      try { await store.health(); return reply(res, 200, { ok: true, mode: demoMode ? "demo" : "production" }); }
      catch { return reply(res, 503, { ok: false, error: "store_unavailable" }); }
    }
    if (req.method === "GET" && req.url === "/v1/billing/plan") return reply(res, 200, billing?.plan || { mode: "unavailable", charging_enabled: false, wld_billing_ready: false, message: "Billing is unavailable." }, origin);
    if (req.url === "/v1/billing/intents") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" }, origin);
      if (demoMode || !billing) return reply(res, 503, { error: "billing_unavailable" }, origin);
      const owner = ownerAuth?.session(cookie(req, "wpg_owner_session"));
      if (ownerAuth && !owner) return reply(res, 401, { error: "owner_auth_required" }, origin);
      try {
        const input = await body(req);
        if (ownerAuth && tenantRegistry && !(await tenantRegistry.listForOwner(owner)).some((project) => project.id === input.projectId)) return reply(res, 403, { error: "project_not_owned" }, origin);
        const result = await billing.createIntent(input); return reply(res, result.status, result.body, origin);
      }
      catch { return reply(res, 400, { error: "billing_intent_failed" }, origin); }
    }
    if (req.url === "/v1/billing/confirmations") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" }, origin);
      if (demoMode || !billing) return reply(res, 503, { error: "billing_unavailable" }, origin);
      try { const result = await billing.confirmPayment(await body(req)); return reply(res, result.status, result.body, origin); }
      catch { return reply(res, 502, { error: "billing_confirmation_failed" }, origin); }
    }
    if (req.url === "/v1/admin/tenants") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
      if (demoMode || !tenantRegistry) return reply(res, 503, { error: "tenant_admin_unavailable" });
      if (!authorized(req, adminToken)) return reply(res, 401, { error: "unauthorized" });
      try { return reply(res, 201, { tenant: await tenantRegistry.create(await body(req)) }); }
      catch { return reply(res, 400, { error: "tenant_create_failed" }); }
    }
    if (req.url === "/v1/owner/proof-context") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
      if (demoMode || !ownerAuth) return reply(res, 503, { error: "owner_auth_unavailable" });
      try { const result = await ownerAuth.proofContext(); return reply(res, result.status, result.body); } catch { return reply(res, 503, { error: "owner_auth_unavailable" }); }
    }
    if (req.url === "/v1/owner/proofs") {
      if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
      if (demoMode || !ownerAuth) return reply(res, 503, { error: "owner_auth_unavailable" });
      try { const result = await ownerAuth.verify(await body(req)); if (result.status !== 200) return reply(res, result.status, result.body); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "set-cookie": ownerCookie(result.body.session) }); return res.end(JSON.stringify({ verified: true })); } catch { return reply(res, 400, { error: "invalid_json" }); }
    }
    if (req.url === "/v1/owner/projects") {
      if (!ownerAuth || !tenantRegistry) return reply(res, 503, { error: "owner_dashboard_unavailable" });
      const owner = ownerAuth.session(cookie(req, "wpg_owner_session"));
      if (!owner) return reply(res, 401, { error: "owner_auth_required" });
      if (req.method === "GET") return reply(res, 200, { projects: (await tenantRegistry.listForOwner(owner)).map(publicTenant) });
      if (req.method === "POST") {
        if (!secureRequest(req)) return reply(res, 400, { error: "https_required" });
        try { const tenant = await tenantRegistry.createForOwner(owner, await body(req)); return reply(res, 201, { tenant: publicTenant(tenant), portal_configuration_required: true }); } catch { return reply(res, 400, { error: "tenant_create_failed" }); }
      }
      return reply(res, 405, { error: "method_not_allowed" });
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
