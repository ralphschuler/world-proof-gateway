import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const version = "v1";

function decodeKey(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("gateway_tenant_encryption_key_required");
  const text = value.startsWith("0x") ? value.slice(2) : value;
  const key = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, "hex") : Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("gateway_tenant_encryption_key_invalid");
  return key;
}

// Envelope is versioned so a future KMS/data-key migration stays possible.
export function createTenantKeyVault(keyMaterial) {
  const key = decodeKey(keyMaterial);
  return {
    seal(plaintext) {
      if (typeof plaintext !== "string" || plaintext.length === 0) throw new Error("tenant_rp_signing_key_required");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    open(envelope) {
      const [storedVersion, ivValue, tagValue, ciphertextValue, ...extra] = String(envelope).split(".");
      if (storedVersion !== version || !ivValue || !tagValue || !ciphertextValue || extra.length) throw new Error("tenant_key_envelope_invalid");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
