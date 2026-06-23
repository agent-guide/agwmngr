import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getServerEnv } from "./server-env";

// AES-256-GCM credential envelope (§4 of docs/multi-tenant-design.md).
//
//   v1:<keyId>:<iv>:<tag>:<ciphertext>   (each segment base64)
//
// The version prefix and keyId make rotation a per-record migration rather than
// a flag day. v1 ships with a single key; keyId is a fingerprint of that key so
// a record encrypted under a different key fails closed (decrypt error) instead
// of silently producing garbage.

const VERSION = "v1";

interface MasterKey {
  key: Buffer;
  keyId: string;
}

let cached: MasterKey | null = null;

function decodeKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  // 32 raw bytes encoded as hex (64 chars) or base64.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Load and validate the master key. Throws a clear error if MANAGER_SECRET_KEY
 * is absent or not exactly 32 bytes — the manager must never silently fall back
 * to plaintext (§4).
 */
export function getMasterKey(): MasterKey {
  if (cached) return cached;
  const raw = getServerEnv("MANAGER_SECRET_KEY");
  if (!raw) {
    throw new Error(
      "MANAGER_SECRET_KEY is required to manage gateway credentials but is not set",
    );
  }
  const key = decodeKey(raw);
  if (!key) {
    throw new Error(
      "MANAGER_SECRET_KEY must decode to exactly 32 bytes (64 hex chars or base64)",
    );
  }
  const keyId = createHash("sha256").update(key).digest("hex").slice(0, 12);
  cached = { key, keyId };
  return cached;
}

/** Whether a usable master key is configured (for boot seeding + health checks). */
export function isEncryptionConfigured(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a UTF-8 secret into the versioned envelope. */
export function encryptSecret(plaintext: string): string {
  const { key, keyId } = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    keyId,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an envelope back to the plaintext secret. Throws on any malformed
 * envelope, key mismatch (rotated/wrong key), or authentication failure — the
 * caller maps this to a credential_undecryptable health/deny state, never to a
 * plaintext fallback or auth success.
 */
export function decryptSecret(envelope: string): string {
  const { key, keyId } = getMasterKey();
  const parts = envelope.split(":");
  if (parts.length !== 5) throw new Error("malformed credential envelope");
  const [version, recordKeyId, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new Error(`unsupported envelope version: ${version}`);
  if (recordKeyId !== keyId) {
    throw new Error("credential encrypted under a different key (rotation/mismatch)");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
