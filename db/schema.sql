-- Required production schema. Use PostgreSQL: NUMERIC(78,0) preserves World ID
-- nullifiers exactly; a bigint or JavaScript Number does not.
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
