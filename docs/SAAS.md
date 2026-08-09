# SaaS operating model — private beta

World Proof Gateway is a multi-tenant verification service for teams that build static or contract-first World Mini Apps.

## Tenant onboarding

1. A customer creates a World Developer Portal app/RP and action.
2. The operator validates the customer domain and action semantics.
3. The customer provides the RP signing key through a secrets manager, never through the dashboard, source repository or support chat.
4. The operator adds a fixed project entry, deploys it, and returns the public project ID plus API endpoints.

Each tenant has its own app, RP, action, key, allowed origins and nullifier namespace. Tenant RP signing keys are encrypted at rest in PostgreSQL using the platform's distinct `GATEWAY_TENANT_ENCRYPTION_KEY`; static frontends receive no private key. Gateway's own `RP_SIGNING_KEY` is reserved for Gateway owner authentication and is never shared with a tenant.

## Product boundary

The service verifies a proof of human and, when enabled, issues a short-lived contract attestation. It is not a wallet, custodian, exchange, identity database or automatic transaction approver. Billing, self-service user accounts, a tenant dashboard and metering are deliberately out of this private-beta release; they require an explicit data-retention, abuse-control and payment design.

## Production checklist

- Run `docker compose up -d --build` only behind a TLS reverse proxy.
- Store every environment variable in a production secret manager.
- Back up PostgreSQL and monitor `/healthz`.
- Add a rate limiter/WAF at the reverse proxy before internet exposure.
- Compile/audit `WorldProofGate.sol` before a contract holds or releases value.
