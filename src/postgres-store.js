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
  async createBillingOrder({ reference, projectId, priceAtomic, requestCredits, expiresAt }) {
    await this.#pool.query(
      "INSERT INTO billing_orders (reference, project_id, price_atomic, request_credits, expires_at) VALUES ($1,$2,$3,$4,$5)",
      [reference, projectId, priceAtomic, requestCredits, expiresAt],
    );
  }
  async getBillingOrder(reference) {
    const result = await this.#pool.query("SELECT reference, project_id, request_credits, status, expires_at FROM billing_orders WHERE reference = $1", [reference]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { reference: row.reference, projectId: row.project_id, requestCredits: row.request_credits, status: row.status, expiresAt: row.expires_at.toISOString() };
  }
  async creditBillingOrder({ reference, transactionId, transactionHash }) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query("UPDATE billing_orders SET status = 'credited', transaction_id = $2, transaction_hash = $3, credited_at = NOW() WHERE reference = $1 AND status = 'pending' AND expires_at > NOW() RETURNING project_id, request_credits", [reference, transactionId, transactionHash]);
      if (!order.rowCount) { await client.query("ROLLBACK"); return null; }
      const row = order.rows[0];
      const credit = await client.query("INSERT INTO project_request_credits (project_id, remaining_requests) VALUES ($1,$2) ON CONFLICT (project_id) DO UPDATE SET remaining_requests = project_request_credits.remaining_requests + EXCLUDED.remaining_requests, updated_at = NOW() RETURNING remaining_requests", [row.project_id, row.request_credits]);
      await client.query("COMMIT");
      return { remainingRequests: credit.rows[0].remaining_requests };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async consumeProjectRequestCredit(projectId) {
    const result = await this.#pool.query("UPDATE project_request_credits SET remaining_requests = remaining_requests - 1, updated_at = NOW() WHERE project_id = $1 AND remaining_requests > 0 RETURNING remaining_requests", [projectId]);
    return result.rowCount ? { remainingRequests: result.rows[0].remaining_requests } : null;
  }
  async restoreProjectRequestCredit(projectId) {
    await this.#pool.query("UPDATE project_request_credits SET remaining_requests = remaining_requests + 1, updated_at = NOW() WHERE project_id = $1", [projectId]);
  }
  async saveOwnerContext(context) {
    await this.#pool.query("INSERT INTO owner_proof_contexts (nonce, action, expires_at) VALUES ($1,$2,to_timestamp($3 / 1000.0))", [context.nonce, context.action, context.expiresAt]);
  }
  async consumeOwnerContext(nonce) {
    const result = await this.#pool.query("UPDATE owner_proof_contexts SET consumed_at = NOW() WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING nonce, action", [nonce]);
    return result.rowCount ? { nonce: result.rows[0].nonce, action: result.rows[0].action, consumed: true } : null;
  }
  async isOwnerEnrolled(nullifier) {
    const result = await this.#pool.query("SELECT 1 FROM owner_nullifiers WHERE nullifier = $1", [nullifier]);
    return result.rowCount === 1;
  }
  async enrollOwnerNullifier(nullifier) {
    const result = await this.#pool.query("INSERT INTO owner_nullifiers (nullifier, enrolled_at, last_login_at) VALUES ($1, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING nullifier", [nullifier]);
    return result.rowCount === 1;
  }
  async recordOwnerLogin(nullifier) {
    const result = await this.#pool.query("UPDATE owner_nullifiers SET last_login_at = NOW() WHERE nullifier = $1 RETURNING nullifier", [nullifier]);
    return result.rowCount === 1;
  }
  async close() { await this.#pool.end(); }
  async health() { await this.#pool.query("SELECT 1"); return true; }
}
