import { createServer } from "node:http";
import { createGateway } from "./gateway.js";
import { MemoryProofStore } from "./store.js";
import { PostgresProofStore } from "./postgres-store.js";
import { createHttpHandler } from "./http-app.js";
import { createTenantKeyVault } from "./crypto.js";
import { PostgresTenantRegistry } from "./tenant-registry.js";
import { createBillingService } from "./billing.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const demoMode = process.env.DEMO_MODE === "true";
if (!demoMode && !process.env.DATABASE_URL) throw new Error("production_requires_database_url");
if (!demoMode && !process.env.GATEWAY_TENANT_ENCRYPTION_KEY) throw new Error("production_requires_gateway_tenant_encryption_key");
if (!demoMode && !process.env.GATEWAY_ADMIN_TOKEN) throw new Error("production_requires_gateway_admin_token");
const store = !demoMode && process.env.DATABASE_URL ? new PostgresProofStore(process.env.DATABASE_URL) : new MemoryProofStore();
const tenantRegistry = !demoMode ? new PostgresTenantRegistry(process.env.DATABASE_URL, createTenantKeyVault(process.env.GATEWAY_TENANT_ENCRYPTION_KEY)) : null;
const projects = tenantRegistry || new Map();
const gateway = createGateway({ projects, store, attestationKey: process.env.GATEWAY_ATTESTATION_KEY });
const billing = createBillingService({
  store,
  receiverAddress: process.env.WLD_RECEIVER_ADDRESS,
  appId: process.env.WORLD_APP_ID,
  developerApiKey: process.env.WORLD_DEVELOPER_API_KEY,
});
const server = createServer(createHttpHandler({ gateway, store, demoMode, tenantRegistry, adminToken: process.env.GATEWAY_ADMIN_TOKEN, billing }));
server.listen(port, host, () => console.log(`World Proof Gateway listening on ${host}:${port}`));
process.on("SIGTERM", () => server.close(() => Promise.all([store.close?.(), tenantRegistry?.close?.()]).finally(() => process.exit(0))));
