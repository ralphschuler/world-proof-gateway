import { createServer } from "node:http";
import { loadProjects } from "./config.js";
import { createGateway } from "./gateway.js";
import { MemoryProofStore } from "./store.js";
import { PostgresProofStore } from "./postgres-store.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const projects = await loadProjects(process.env.PROJECTS_CONFIG_PATH || "./config/projects.json");
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) throw new Error("production_requires_database_url");
const store = process.env.DATABASE_URL ? new PostgresProofStore(process.env.DATABASE_URL) : new MemoryProofStore();
const gateway = createGateway({ projects, store, attestationKey: process.env.GATEWAY_ATTESTATION_KEY });

function reply(res, status, body, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) { headers["access-control-allow-origin"] = origin; headers.vary = "Origin"; }
  res.writeHead(status, headers); res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error("body_too_large"); }
  return raw ? JSON.parse(raw) : {};
}
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "GET" && req.url === "/healthz") {
    try { await store.health(); return reply(res, 200, { ok: true }); }
    catch { return reply(res, 503, { ok: false, error: "store_unavailable" }); }
  }
  const match = req.url?.match(/^\/v1\/projects\/([a-z0-9-]{3,48})\/(proof-context|proofs)$/);
  if (!match) return reply(res, 404, { error: "not_found" });
  if (req.method === "OPTIONS") return reply(res, 204, {}, origin);
  if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" }, origin);
  try {
    const result = match[2] === "proof-context" ? await gateway.proofContext(match[1], await body(req), origin) : await gateway.verify(match[1], await body(req), origin);
    return reply(res, result.status, result.body, origin);
  } catch { return reply(res, 400, { error: "invalid_json" }, origin); }
});
server.listen(port, host, () => console.log(`World Proof Gateway listening on ${host}:${port}`));
process.on("SIGTERM", () => server.close(() => store.close?.().finally(() => process.exit(0))));
