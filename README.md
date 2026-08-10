# World Proof Gateway

Deployable, multi-tenant **trusted backend boundary** for World-ID-enabled, mostly-static Mini Apps. It lets a static frontend request an RP context and submit an IDKit proof without ever receiving an RP signing key. It is deliberately a service, not a client-side workaround.

## What this unlocks

Each tenant/project registers a fixed `app_id`, `rp_id`, action, allowed browser origins and one private RP signing key. The platform encrypts each tenant key with AES-256-GCM before storing it in PostgreSQL; it decrypts it only in memory while creating that tenant's `rp_context`. The static app only needs two endpoints:

1. `POST /v1/projects/:project/proof-context` with its fixed action and optional signal.
2. `POST /v1/projects/:project/proofs` with the untouched `idkitResponse`.

The gateway signs the context server-side, sends the untouched proof to World, and atomically records the `(project, action, nullifier)` tuple. It does **not** accept client-provided RP IDs, app IDs or arbitrary actions.

`RP_SIGNING_KEY` is reserved for the Gateway's own World ID owner/authentication flow. It is not a tenant key and is never reused to sign tenant proofs. `GATEWAY_TENANT_ENCRYPTION_KEY` protects tenant RP keys at rest; `GATEWAY_ATTESTATION_KEY` is a separate optional EIP-712 signing key.

## Developer dashboard MVP

`/dashboard` authenticates a developer with the Gateway's fixed World App/RP (`GATEWAY_OWNER_APP_ID`, `GATEWAY_OWNER_RP_ID`, `RP_SIGNING_KEY`). After a valid World ID proof, the Gateway automatically creates or reuses the developer account represented by that scoped nullifier. There is no global admin enrollment, browser bootstrap flow or dynamic platform configuration endpoint. The nullifier is neither a wallet address nor a private key; it only scopes the developer's own projects. The server signs the login RP context, directly verifies the untouched proof with World, and issues an eight-hour `HttpOnly; Secure; SameSite=Lax` session cookie signed with `GATEWAY_SESSION_SECRET`. Login contexts are separate from tenant proof contexts and never consume request credits.

An authenticated owner can create and list only their own projects. The owner must create the App, RP and action in the World Developer Portal and enter that Portal-issued RP signing key once in the HTTPS dashboard. The Gateway does not generate tenant signing keys: it encrypts the submitted key envelope at rest and never returns, lists or displays the key. Portal configuration is a manual prerequisite because no documented runtime API can register a Gateway-generated key.

For Mini Apps whose gameplay is fully on-chain, the gateway issues a short-lived EIP-712 attestation after verification. `contracts/src/WorldProofGate.sol` validates that attestation and prevents replay. This keeps game state in the contract while making the gateway the explicit, auditable identity trust boundary. World ID 4 on-chain verification is documented as preview/not mainnet-ready, so this attestation must not be silently substituted for direct World proof verification.

## Run locally

```bash
# Put keys only in process secret environment. `RP_SIGNING_KEY` belongs to the
# Gateway's own World RP; individual tenant keys are encrypted in PostgreSQL.
export RP_SIGNING_KEY=0x...
export GATEWAY_TENANT_ENCRYPTION_KEY=replace-with-32-byte-base64url-or-64-hex-key
npm install
npm test
npm start
```

`MemoryProofStore` is for tests/dev only. Set `DATABASE_URL` and run `db/schema.sql` before production start; `PostgresProofStore` uses atomic updates/inserts for context and nullifier replay prevention. Production start fails without `DATABASE_URL`.

## Private-beta onboarding and demo mode

`GET /` serves a mobile-first checkout surface. In World App it uses MiniKit Pay; in a regular browser it clearly explains that WLD checkout needs World App.

## WLD request packs

The initial plan is fixed at **1 WLD for 5,000 proof-context requests**. MiniKit represents 1 WLD as `1000000000000000000` atomic units (18 decimals). The browser asks World App's MiniKit Pay command for a one-time payment reference. The gateway then queries the World Developer Portal itself and credits the project only when the response is `mined` and its reference, app ID, World Chain, WLD amount, receiver and transaction ID all match exactly. A browser response alone can never create credits. In production, the context endpoint atomically consumes one credit; no credit means HTTP `402` and no signed context.

Set `WLD_RECEIVER_ADDRESS`, `WORLD_APP_ID` and `WORLD_DEVELOPER_API_KEY` only in server-side deployment secret storage. The Portal API key is used solely to verify payment transactions; never expose it to a Mini App, static host or browser variable. `GET /v1/billing/plan` reports readiness. `POST /v1/billing/intents` creates a 15-minute reference for an existing project and `POST /v1/billing/confirmations` completes an already-submitted MiniKit payment after server-side reconciliation.

`POST /v1/support-requests` accepts only an email and a short message. With the in-memory test/demo store it is explicitly non-production and is lost on restart. With PostgreSQL it returns `503` until a reviewed durable support schema is added; do not use it for production support intake yet.

For a deployment smoke test without any World secrets, project config, or database, set `DEMO_MODE=true`:

```bash
DEMO_MODE=true NODE_ENV=production npm start
```

Or use the self-contained reviewer profile: `docker compose -f compose.demo.yaml up --build`.

Demo mode identifies itself in both `/` and `/healthz`. Its health check succeeds using the in-memory test layer, but every proof-context and proof-verification endpoint returns `503 demo_mode_real_proofs_disabled`; it does not contact World and cannot verify or credit real proofs. Do not set `DEMO_MODE` for a real deployment. Outside demo mode, production startup fails closed without `DATABASE_URL`, and project loading fails without the configured signing-key environment variables.

## Deploy

1. Copy `config/projects.example.json` to private `config/projects.json` and register each tenant's exact World app, RP, action and allowed origin.
2. Put `POSTGRES_PASSWORD`, each tenant RP signing key, and (only for on-chain attestation tenants) `GATEWAY_ATTESTATION_KEY` in a secrets manager or deployment environment.
3. Run `docker compose up -d --build` behind a TLS reverse proxy. The Compose port intentionally binds only to localhost.
4. Monitor `GET /healthz`; it returns `503` if PostgreSQL is unavailable.

### Tenant provisioning

World Proof Gateway does not create or rotate tenant RP keys. A verified developer creates/configures each RP in the World Developer Portal and enters the Portal-issued key once through the HTTPS dashboard. The key is encrypted at rest, is never returned, and each project is bound to the verified developer account that created it. No documented runtime API can register a Gateway-generated key.

For a Custom App review/demo deployment, use the same container with `DEMO_MODE=true` and omit real World/database configuration. The page must remain visibly marked DEMO. This mode is only suitable for health checks and onboarding review, never for proof verification or asset crediting.

The public client contract is in [docs/API.md](docs/API.md); the current private-beta SaaS model is in [docs/SAAS.md](docs/SAAS.md).

### TrueNAS demo

`deploy/truenas-demo.yaml` installs a public, 24-hour demo image through **Apps → Discover → Install via YAML**. It uses only port `31056` and starts with `DEMO_MODE=true`: onboarding and support UI are testable, while real proofs, WLD transfers, tenant setup and secret storage are all blocked. Production images remain in GHCR and require registry credentials.

The installed demo also exposes an empty `RP_SIGNING_KEY` field in its TrueNAS App environment. Enter the Gateway's own World RP key only in the TrueNAS secret/environment editor; it must never be committed, pasted into a Mini App, or placed in a `VITE_*` variable. The value is intentionally ignored while `DEMO_MODE=true`.

### TrueNAS production bundle

`deploy/truenas-production.yaml` runs the Gateway and its private PostgreSQL database as one Custom App. PostgreSQL has no host port; its named volume persists data. Before installing it, replace the placeholder values in TrueNAS's secret editor: database password, 32-byte tenant-encryption key and the Gateway's own World ID `RP_SIGNING_KEY`. The image reference must point to a published, immutable production image; do not use the 24-hour demo image for real proofs.

## Deployment guardrails

- TLS, a durable PostgreSQL store, request-size limits, per-IP/project rate limits and structured audit logs are mandatory before public traffic.
- Keep each tenant's RP signing key in a secrets manager. Do not place it in GitHub Pages, frontend variables or a Mini App bundle.
- Check the configured project/action/origin server-side. CORS is browser protection, not tenant authentication.
- Bind a proof signal to a wallet address only when the product needs that association. Store only what the authorization model requires.
- A verified proof is not a session. Issue a bounded, server-signed authorization or perform contract-level proof verification before crediting assets. EIP-712 attestations require a wallet-address signal and a gateway signer configured only on the server.

## IdleMint adoption

After a tenant is registered and active, set its static client to the fixed `/v1/projects/{tenantId}/proof-context` and `/v1/projects/{tenantId}/proofs` endpoints. Browser demo mode remains local and need not call this service.

## Sources

- [World IDKit integration](https://docs.world.org/world-id/idkit/integrate)
- [World proof verification API](https://docs.world.org/api-reference/developer-portal/verify)
- [World on-chain verification status](https://docs.world.org/world-id/idkit/onchain-verification)
