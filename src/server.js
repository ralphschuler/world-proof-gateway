import { createServer } from "node:http";
import { loadProjects } from "./config.js";
import { createGateway } from "./gateway.js";
import { MemoryProofStore } from "./store.js";
import { PostgresProofStore } from "./postgres-store.js";
import { createHttpHandler } from "./http-app.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const demoMode = process.env.DEMO_MODE === "true";
if (!demoMode && process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) throw new Error("production_requires_database_url");
const projects = demoMode ? new Map() : await loadProjects(process.env.PROJECTS_CONFIG_PATH || "./config/projects.json");
const store = !demoMode && process.env.DATABASE_URL ? new PostgresProofStore(process.env.DATABASE_URL) : new MemoryProofStore();
const gateway = createGateway({ projects, store, attestationKey: process.env.GATEWAY_ATTESTATION_KEY });
const server = createServer(createHttpHandler({ gateway, store, demoMode }));
server.listen(port, host, () => console.log(`World Proof Gateway listening on ${host}:${port}`));
process.on("SIGTERM", () => server.close(() => store.close?.().finally(() => process.exit(0))));
