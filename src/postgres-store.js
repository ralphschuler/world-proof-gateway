import pg from "pg";

// Atomic SQL operations are the authorization boundary for replay prevention.
// Run db/schema.sql before starting production traffic.
export class PostgresProofStore {
  #pool;
  constructor(connectionString) { this.#pool = new pg.Pool({ connectionString, max: 10 }); }
  async saveContext(context) {
    await this.#pool.query(
      "INSERT INTO proof_contexts (nonce, project_id, action, signal_hash, subject, expires_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))",
      [context.nonce, context.projectId, context.action, context.signalHash, context.subject, context.expiresAt],
    );
  }
  async consumeContext(nonce) {
    const result = await this.#pool.query(
      "UPDATE proof_contexts SET consumed_at = NOW() WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING nonce, project_id, action, signal_hash, subject",
      [nonce],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { nonce: row.nonce, projectId: row.project_id, action: row.action, signalHash: row.signal_hash, subject: row.subject, consumed: true };
  }
  async claimNullifier({ projectId, action, nullifier }) {
    const result = await this.#pool.query(
      "INSERT INTO verified_nullifiers (project_id, action, nullifier) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING nullifier",
      [projectId, action, nullifier],
    );
    return result.rowCount === 1;
  }
  async close() { await this.#pool.end(); }
  async health() { await this.#pool.query("SELECT 1"); return true; }
}
