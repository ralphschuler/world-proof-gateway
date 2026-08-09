-- Required production schema. Use PostgreSQL: NUMERIC(78,0) preserves World ID
-- nullifiers exactly; a bigint or JavaScript Number does not.
CREATE TABLE IF NOT EXISTS tenant_projects (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  app_id TEXT NOT NULL UNIQUE,
  rp_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'staging')),
  allowed_origins JSONB NOT NULL,
  signal_policy TEXT NOT NULL CHECK (signal_policy IN ('none', 'wallet-address')),
  attestation JSONB,
  signing_key_envelope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proof_contexts (
  nonce TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  signal_hash TEXT NOT NULL,
  subject TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS verified_nullifiers (
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  nullifier NUMERIC(78,0) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, action, nullifier)
);

-- Payment references are one-time, short lived, and reconciled only after the
-- World Developer Portal reports an on-chain mined payment.
CREATE TABLE IF NOT EXISTS billing_orders (
  reference TEXT PRIMARY KEY CHECK (reference ~ '^wpg_[a-f0-9]{32}$'),
  project_id TEXT NOT NULL REFERENCES tenant_projects(id),
  price_atomic NUMERIC(30,0) NOT NULL CHECK (price_atomic > 0),
  request_credits INTEGER NOT NULL CHECK (request_credits > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited')),
  transaction_id TEXT UNIQUE,
  transaction_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_request_credits (
  project_id TEXT PRIMARY KEY REFERENCES tenant_projects(id),
  remaining_requests BIGINT NOT NULL DEFAULT 0 CHECK (remaining_requests >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
