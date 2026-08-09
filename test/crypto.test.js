import test from "node:test";
import assert from "node:assert/strict";
import { createTenantKeyVault } from "../src/crypto.js";

test("tenant RP keys are encrypted and authenticated at rest", () => {
  const vault = createTenantKeyVault("11".repeat(32));
  const envelope = vault.seal("0x" + "ab".repeat(32));
  assert.match(envelope, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(vault.open(envelope), "0x" + "ab".repeat(32));
  const tampered = envelope.split(".");
  tampered[2] = (tampered[2].startsWith("A") ? "B" : "A") + tampered[2].slice(1);
  assert.throws(() => vault.open(tampered.join(".")));
});

test("tenant vault rejects missing or weak master keys", () => {
  assert.throws(() => createTenantKeyVault("short"), /gateway_tenant_encryption_key_invalid/);
  assert.throws(() => createTenantKeyVault(), /gateway_tenant_encryption_key_required/);
});
