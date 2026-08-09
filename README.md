# World Proof Gateway

Reusable **trusted backend boundary** for World-ID-enabled, mostly-static Mini Apps. It lets a static frontend request an RP context and submit an IDKit proof without ever receiving an RP signing key. It is deliberately a service, not a client-side workaround.

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
