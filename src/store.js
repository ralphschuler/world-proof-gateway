// The interface is intentionally tiny so production can replace this local
// adapter with the Postgres schema in db/schema.sql. Memory is never acceptable
// for production: restart would allow a nullifier replay.
export class MemoryProofStore {
  #contexts = new Map();
  #nullifiers = new Set();

  async saveContext(context) { this.#contexts.set(context.nonce, context); }
  async consumeContext(nonce) {
    const context = this.#contexts.get(nonce);
    if (!context || context.consumed || context.expiresAt <= Date.now()) return null;
    context.consumed = true;
    return context;
  }
  async claimNullifier({ projectId, action, nullifier }) {
    const key = `${projectId}:${action}:${nullifier}`;
    if (this.#nullifiers.has(key)) return false;
    this.#nullifiers.add(key);
    return true;
  }
  async health() { return true; }
}
