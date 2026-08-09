import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, toHex } from "viem";

const zeroHash = "0x0";
const wallet = /^0x[a-fA-F0-9]{40}$/;

function normalizeHex(value) {
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}
function json(status, body) { return { status, body }; }
function responseSignal(response) { return response?.responses?.[0]?.signal_hash; }

export function createGateway({ projects, store, fetchImpl = globalThis.fetch, attestationKey, now = () => Date.now(), enforceRequestCredits = false }) {
  if (!projects || !store || typeof fetchImpl !== "function") throw new Error("gateway_dependencies_required");
  const signer = attestationKey ? privateKeyToAccount(attestationKey) : null;
  async function projectFor(projectId) { return projects.get(projectId); }
  function originAllowed(project, origin) { return !origin || project.allowedOrigins.includes(origin); }

  async function proofContext(projectId, { action, signal } = {}, origin) {
    const project = await projectFor(projectId);
    if (!project) return json(404, { error: "unknown_project" });
    if (!originAllowed(project, origin)) return json(403, { error: "origin_not_allowed" });
    if (action !== project.action) return json(400, { error: "action_not_allowed" });
    if (project.signalPolicy === "wallet-address" && (!wallet.test(signal || ""))) return json(400, { error: "wallet_signal_required" });
    if (project.signalPolicy === "none" && signal !== undefined) return json(400, { error: "signal_not_allowed" });
    if (enforceRequestCredits && !await store.consumeProjectRequestCredit(projectId)) return json(402, { error: "request_credits_exhausted", message: "Buy a WLD request pack to continue." });
    const sig = signRequest({ action: project.action, signingKeyHex: project.signingKey });
    const signalHash = signal ? hashSignal(signal.toLowerCase()) : zeroHash;
    try { await store.saveContext({ nonce: sig.nonce, projectId, action, signalHash: normalizeHex(signalHash), subject: signal?.toLowerCase() || null, expiresAt: Number(sig.expiresAt) * 1000, consumed: false }); }
    catch (error) { if (enforceRequestCredits) await store.restoreProjectRequestCredit?.(projectId); throw error; }
    return json(200, { app_id: project.appId, action: project.action, environment: project.environment, rp_context: { rp_id: project.rpId, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig } });
  }

  async function verify(projectId, { idkitResponse } = {}, origin) {
    const project = await projectFor(projectId);
    if (!project) return json(404, { error: "unknown_project" });
    if (!originAllowed(project, origin)) return json(403, { error: "origin_not_allowed" });
    const nonce = idkitResponse?.nonce;
    if (typeof nonce !== "string" || idkitResponse?.action !== project.action || idkitResponse?.environment !== project.environment) return json(400, { error: "invalid_proof_shape" });
    const context = await store.consumeContext(nonce);
    if (!context || context.projectId !== projectId || context.action !== project.action) return json(409, { error: "expired_or_replayed_context" });
    if (normalizeHex(responseSignal(idkitResponse)) !== context.signalHash) return json(400, { error: "signal_mismatch" });
    let upstream;
    try {
      upstream = await fetchImpl(`https://developer.world.org/api/v4/verify/${project.rpId}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "world-proof-gateway/0.1" }, body: JSON.stringify(idkitResponse) });
    } catch { return json(502, { error: "world_verify_unavailable" }); }
    let verified; try { verified = await upstream.json(); } catch { return json(502, { error: "world_verify_invalid_response" }); }
    if (!upstream.ok || verified?.success !== true || verified.action !== project.action || verified.environment !== project.environment) return json(422, { error: "world_proof_rejected" });
    const nullifier = normalizeHex(verified.nullifier);
    if (!nullifier) return json(422, { error: "world_nullifier_missing" });
    if (!await store.claimNullifier({ projectId, action: project.action, nullifier: BigInt(nullifier).toString(10) })) return json(409, { error: "nullifier_already_used" });
    const result = { verified: true, project_id: projectId, action: project.action, verification_id: crypto.randomUUID() };
    if (project.attestation && !signer) return json(503, { error: "gateway_attestation_unavailable" });
    if (project.attestation && signer) {
      const deadline = Math.floor(now() / 1000) + (project.attestation.ttlSeconds || 300);
      if (!wallet.test(context.subject || "")) return json(422, { error: "wallet_subject_required" });
      const payload = {
        project: keccak256(stringToHex(projectId)), action: keccak256(stringToHex(project.action)),
        subject: context.subject, nullifier: toHex(BigInt(nullifier), { size: 32 }),
        deadline, nonce: keccak256(stringToHex(result.verification_id)),
      };
      const domain = { name: "World Proof Gateway", version: "1", chainId: project.attestation.chainId, verifyingContract: project.attestation.verifyingContract };
      const types = { WorldProof: [
        { name: "project", type: "bytes32" }, { name: "action", type: "bytes32" }, { name: "subject", type: "address" },
        { name: "nullifier", type: "bytes32" }, { name: "deadline", type: "uint64" }, { name: "nonce", type: "bytes32" },
      ] };
      result.attestation = { domain, types, payload, signature: await signer.signTypedData({ domain, types, primaryType: "WorldProof", message: payload }) };
    }
    return json(200, result);
  }

  return { proofContext, verify };
}
