import pg from "pg";

const projectId = /^[a-z0-9][a-z0-9-]{2,47}$/;
const appId = /^app_[A-Za-z0-9]+$/;
const rpId = /^rp_[A-Za-z0-9]+$/;
const action = /^[a-z0-9][a-z0-9-]{2,80}$/;

function validateTenant(input) {
  if (!input || !projectId.test(input.id || "")) throw new Error("invalid_tenant_id");
  if (!appId.test(input.appId || "") || !rpId.test(input.rpId || "") || !action.test(input.action || "")) throw new Error("invalid_tenant_world_config");
  if (!["production", "staging"].includes(input.environment)) throw new Error("invalid_tenant_environment");
  if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length === 0 || input.allowedOrigins.some((origin) => { try { return new URL(origin).protocol !== "https:"; } catch { return true; } })) throw new Error("invalid_tenant_origins");
  if (!["none", "wallet-address"].includes(input.signalPolicy)) throw new Error("invalid_tenant_signal_policy");
  if (typeof input.rpSigningKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.rpSigningKey)) throw new Error("tenant_rp_signing_key_required");
  return input;
}

export class PostgresTenantRegistry {
  #pool; #vault;
  constructor(connectionString, vault) {
    if (!vault) throw new Error("tenant_key_vault_required");
    this.#pool = new pg.Pool({ connectionString, max: 10 }); this.#vault = vault;
  }
  async get(id) {
    const result = await this.#pool.query("SELECT id, app_id, rp_id, action, environment, allowed_origins, signal_policy, attestation, signing_key_envelope FROM tenant_projects WHERE id = $1 AND status = 'active'", [id]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { id: row.id, appId: row.app_id, rpId: row.rp_id, action: row.action, environment: row.environment, allowedOrigins: row.allowed_origins, signalPolicy: row.signal_policy, attestation: row.attestation || null, signingKey: this.#vault.open(row.signing_key_envelope) };
  }
  async create(input) {
    const tenant = validateTenant(input);
    const result = await this.#pool.query(
      "INSERT INTO tenant_projects (id, app_id, rp_id, action, environment, allowed_origins, signal_policy, attestation, signing_key_envelope, owner_nullifier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, app_id, rp_id, action, environment, allowed_origins, signal_policy, status, created_at",
      [tenant.id, tenant.appId, tenant.rpId, tenant.action, tenant.environment, JSON.stringify(tenant.allowedOrigins), tenant.signalPolicy, tenant.attestation ? JSON.stringify(tenant.attestation) : null, this.#vault.seal(tenant.rpSigningKey), tenant.ownerNullifier || null],
    );
    const row = result.rows[0];
    return { id: row.id, appId: row.app_id, rpId: row.rp_id, action: row.action, environment: row.environment, allowedOrigins: row.allowed_origins, signalPolicy: row.signal_policy, status: row.status, createdAt: row.created_at };
  }
  async listForOwner(ownerNullifier) {
    const result = await this.#pool.query("SELECT id, app_id, rp_id, action, environment, allowed_origins, signal_policy, status, created_at FROM tenant_projects WHERE owner_nullifier = $1 ORDER BY created_at DESC", [ownerNullifier]);
    return result.rows.map((row) => ({ id: row.id, appId: row.app_id, rpId: row.rp_id, action: row.action, environment: row.environment, allowedOrigins: row.allowed_origins, signalPolicy: row.signal_policy, status: row.status, createdAt: row.created_at }));
  }
  async createForOwner(ownerNullifier, input) {
    return this.create({ ...input, ownerNullifier });
  }
  async close() { await this.#pool.end(); }
}
