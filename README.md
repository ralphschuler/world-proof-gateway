# World Proof Gateway

Deployable, multi-tenant **trusted backend boundary** for World-ID-enabled, mostly-static Mini Apps. It lets a static frontend request an RP context and submit an IDKit proof without ever receiving an RP signing key. It is deliberately a service, not a client-side workaround.

## What this unlocks

Each tenant/project registers a fixed `app_id`, `rp_id`, action, allowed browser origins and one private RP signing key. The static app only needs two endpoints:

1. `POST /v1/projects/:project/proof-context` with its fixed action and optional signal.
2. `POST /v1/projects/:project/proofs` with the untouched `idkitResponse`.

The gateway signs the context server-side, sends the untouched proof to World, and atomically records the `(project, action, nullifier)` tuple. It does **not** accept client-provided RP IDs, app IDs or arbitrary actions.

For Mini Apps whose gameplay is fully on-chain, the gateway issues a short-lived EIP-712 attestation after verification. `contracts/src/WorldProofGate.sol` validates that attestation and prevents replay. This keeps game state in the contract while making the gateway the explicit, auditable identity trust boundary. World ID 4 on-chain verification is documented as preview/not mainnet-ready, so this attestation must not be silently substituted for direct World proof verification.

## Run locally

```bash
cp config/projects.example.json config/projects.json
# Put the RP signing key only in the process secret environment.
export IDLEMINT_RP_SIGNING_KEY=0x...
npm install
npm test
npm start
```

`MemoryProofStore` is for tests/dev only. Set `DATABASE_URL` and run `db/schema.sql` before production start; `PostgresProofStore` uses atomic updates/inserts for context and nullifier replay prevention. Production start fails without `DATABASE_URL`.

## Private-beta onboarding and demo mode

`GET /` serves a minimal browser onboarding page. It explains World ID, separate wallet authentication, WLD billing readiness, a deliberately non-functional unique setup-link placeholder, and a support form. Ordinary browser visitors can safely use this page; it never requests a proof, connects a wallet, or starts a payment.

`GET /v1/billing/plan` is a read-only configuration view. It explicitly reports that WLD billing is not ready and that charging, prices, receivers, payment collection, MiniKit Pay, and token transfers are absent.

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

For a Custom App review/demo deployment, use the same container with `DEMO_MODE=true` and omit real World/database configuration. The page must remain visibly marked DEMO. This mode is only suitable for health checks and onboarding review, never for proof verification or asset crediting.

The public client contract is in [docs/API.md](docs/API.md); the current private-beta SaaS model is in [docs/SAAS.md](docs/SAAS.md).

### TrueNAS demo

`deploy/truenas-demo.yaml` installs a public, 24-hour demo image through **Apps → Discover → Install via YAML**. It uses only port `31056` and starts with `DEMO_MODE=true`: onboarding and support UI are testable, while real proofs, WLD transfers, tenant setup and secret storage are all blocked. Production images remain in GHCR and require registry credentials.

## Deployment guardrails

- TLS, a durable PostgreSQL store, request-size limits, per-IP/project rate limits and structured audit logs are mandatory before public traffic.
- Keep each tenant's RP signing key in a secrets manager. Do not place it in GitHub Pages, frontend variables or a Mini App bundle.
- Check the configured project/action/origin server-side. CORS is browser protection, not tenant authentication.
- Bind a proof signal to a wallet address only when the product needs that association. Store only what the authorization model requires.
- A verified proof is not a session. Issue a bounded, server-signed authorization or perform contract-level proof verification before crediting assets. EIP-712 attestations require a wallet-address signal and a gateway signer configured only on the server.

## IdleMint adoption

Set IdleMint's existing `VITE_WORLD_ID_PROOF_CONTEXT_URL` and `VITE_WORLD_ID_VERIFY_URL` to its fixed project endpoints after this service has a real registered RP and durable database. Browser demo mode remains local and need not call this service.

## Sources

- [World IDKit integration](https://docs.world.org/world-id/idkit/integrate)
- [World proof verification API](https://docs.world.org/api-reference/developer-portal/verify)
- [World on-chain verification status](https://docs.world.org/world-id/idkit/onchain-verification)
