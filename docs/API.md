# Public integration API

Base URL: `https://proof.example.com`. Each static Mini App owns a fixed project ID, configured by the SaaS operator after World Developer Portal registration.

## Private-beta browser and configuration endpoints

`GET /` is a harmless static onboarding page for regular browsers. It contains no IDKit request, wallet connection, payment form, price, receiver, or setup activation. The displayed setup URL is a placeholder that the operator must replace with a tenant-specific private link after approval.

`GET /v1/billing/plan` returns the non-charging beta configuration:

```json
{ "mode": "configuration_only", "charging_enabled": false, "wld_billing_ready": false }
```

No billing endpoint can charge WLD or any other token. There is no MiniKit Pay integration.

`POST /v1/support-requests` accepts `{ "email": "...", "message": "..." }`. It is only persisted by the test/demo `MemoryProofStore`, where it is non-durable and erased on restart. A PostgreSQL-backed production service returns `503` for this endpoint until a durable support schema is explicitly reviewed and implemented.

When `DEMO_MODE=true`, `/healthz` returns `{ "ok": true, "mode": "demo" }`; all project proof endpoints return `503` with `demo_mode_real_proofs_disabled`, without contacting World or crediting anything.

## Request a proof context

`POST /v1/projects/{projectId}/proof-context`

```json
{ "action": "idlemint-game-access-v1", "signal": "0xwallet..." }
```

The service rejects every action other than the registered action. The response contains `app_id`, fixed `action`, `environment`, and the signed `rp_context` required by IDKit. A `wallet-address` signal is required only for a tenant that uses contract attestations.

## Verify a proof

`POST /v1/projects/{projectId}/proofs`

```json
{ "idkitResponse": { "protocol_version": "4.0", "nonce": "...", "action": "...", "responses": [] } }
```

Send the IDKit result unchanged. A successful response is `{ "verified": true }`; contract-enabled projects additionally receive an EIP-712 payload/signature. A repeated context or nullifier returns HTTP `409`.

## Browser example

```js
const context = await fetch(`${gateway}/v1/projects/idlemint/proof-context`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "idlemint-game-access-v1", signal: walletAddress }),
}).then((r) => r.json());

const request = await IDKit.request({
  app_id: context.app_id, action: context.action, rp_context: context.rp_context,
  environment: context.environment, allow_legacy_proofs: false,
}).preset(proofOfHuman({ signal: walletAddress }));
const completed = await request.pollUntilCompletion();
const verified = await fetch(`${gateway}/v1/projects/idlemint/proofs`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ idkitResponse: completed.result }),
}).then((r) => r.json());
```
