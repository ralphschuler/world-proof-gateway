// The interface is intentionally tiny so production can replace this local
// adapter with the Postgres schema in db/schema.sql. Memory is never acceptable
// for production: restart would allow a nullifier replay.
export class MemoryProofStore {
  #contexts = new Map();
  #nullifiers = new Set();
  #supportRequests = [];
  #billingOrders = new Map();
  #credits = new Map();
  #ownerContexts = new Map();
  #ownerNullifiers = new Set();

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
  // Explicitly non-production: this is intentionally lost on restart.
  async saveSupportRequest(request) { this.#supportRequests.push(request); }
  async listSupportRequests() { return [...this.#supportRequests]; }
  async createBillingOrder(order) { this.#billingOrders.set(order.reference, { ...order, status: "pending" }); }
  async getBillingOrder(reference) { const order = this.#billingOrders.get(reference); return order ? { ...order } : null; }
  async creditBillingOrder({ reference, transactionId, transactionHash }) {
    const order = this.#billingOrders.get(reference);
    if (!order || order.status !== "pending" || Date.parse(order.expiresAt) <= Date.now()) return null;
    if ([...this.#billingOrders.values()].some((entry) => entry.transactionId === transactionId)) return null;
    order.status = "credited"; order.transactionId = transactionId; order.transactionHash = transactionHash;
    const remainingRequests = (this.#credits.get(order.projectId) || 0) + order.requestCredits;
    this.#credits.set(order.projectId, remainingRequests);
    return { remainingRequests };
  }
  async consumeProjectRequestCredit(projectId) {
    const remaining = this.#credits.get(projectId) || 0;
    if (remaining <= 0) return null;
    this.#credits.set(projectId, remaining - 1);
    return { remainingRequests: remaining - 1 };
  }
  async restoreProjectRequestCredit(projectId) { this.#credits.set(projectId, (this.#credits.get(projectId) || 0) + 1); }
  async saveOwnerContext(context) { this.#ownerContexts.set(context.nonce, context); }
  async consumeOwnerContext(nonce) { const context = this.#ownerContexts.get(nonce); if (!context || context.consumed || context.expiresAt <= Date.now()) return null; context.consumed = true; return context; }
  async isOwnerEnrolled(nullifier) { return this.#ownerNullifiers.has(nullifier); }
  async enrollOwnerNullifier(nullifier) {
    if (this.#ownerNullifiers.has(nullifier)) return false;
    this.#ownerNullifiers.add(nullifier);
    return true;
  }
  async recordOwnerLogin(nullifier) { return this.#ownerNullifiers.has(nullifier); }
}
