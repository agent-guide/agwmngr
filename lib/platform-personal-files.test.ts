import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { ObjectStoreConflictError, type ObjectStore } from "@/packages/platform/ports/objects";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { PersonalFileRegistry } from "@/packages/platform/services/personal-file-registry";
import { PersonalFileService, collectPersonalFileGarbage } from "@/packages/platform/services/personal-files";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

class MemoryObjects implements ObjectStore {
  readonly values = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = this.values.get(key);
    if (existing && createHash("sha256").update(existing).digest("hex") !== hash) {
      throw new ObjectStoreConflictError();
    }
    this.values.set(key, bytes.slice());
    return { sizeBytes: bytes.byteLength, contentHash: hash };
  }
  async stat(key: string) {
    const bytes = this.values.get(key);
    return bytes ? { sizeBytes: bytes.byteLength, contentHash: createHash("sha256").update(bytes).digest("hex") } : null;
  }
  async read(key: string) {
    const bytes = this.values.get(key);
    if (!bytes) throw new Error("missing");
    return bytes.slice();
  }
  async remove(key: string) { this.values.delete(key); }
}

async function verifyPersonalFiles(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  let sequence = 0;
  let now = new Date("2026-10-19T00:00:00.000Z");
  const serviceToken = `agwmngr_svc_${"a".repeat(64)}`;
  const identity = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) { return users.get(id) ?? null; },
      async findUserByUsername(username) { return [...users.values()].find((user) => user.username === username) ?? null; },
      async listUsers() { return [...users.values()]; },
      async findGateway() { return null; },
    },
    {
      digest: (token) => createHash("sha256").update(token).digest("hex"),
      issue: () => ({ id: "credential:files", token: serviceToken, digest: createHash("sha256").update(serviceToken).digest("hex") }),
    },
    { digest: (token) => `receipt:${token}`, issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }) },
    () => now,
  );
  const objects = new MemoryObjects();
  const registry = new PersonalFileRegistry(database);
  const files = new PersonalFileService(registry, identity, objects, {
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    now: () => now.toISOString(),
    hash: (value) => createHash("sha256").update(value).digest("hex"),
    hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
    decodeBase64: (value) => Buffer.from(value, "base64"),
    encodeBase64: (value) => Buffer.from(value).toString("base64"),
  });
  const admin: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  const bob: PlatformActorReference = { kind: "human", userId: 3 };
  await identity.createTenant(admin, "alpha", "Alpha");
  await identity.bootstrapMembership(admin, "alpha", "user:2", "user");
  await identity.bootstrapMembership(admin, "alpha", "user:3", "admin");
  const service = await identity.createService(admin, "files-worker", "2027-01-01T00:00:00.000Z");
  await identity.bootstrapMembership(admin, "alpha", service.principal.id, "user");
  const serviceActor = await identity.authenticateService(service.token);

  await expect(files.list(serviceActor, "alpha")).rejects.toMatchObject({ code: "forbidden" });
  await identity.setMembership(admin, "alpha", service.principal.id, "admin");
  await expect(files.initiate(serviceActor, "alpha", {
    requestKey: "service-denied", name: "worker.txt", mimeType: "text/plain", sizeBytes: 1,
  })).rejects.toMatchObject({ code: "forbidden" });

  const bytes = new TextEncoder().encode("private file");
  const initiated = await files.initiate(alice, "alpha", {
    requestKey: "private-one", name: "notes.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength,
  });
  expect(initiated.item).toMatchObject({ ownerPrincipalId: "user:2", ownerUserId: 2, previewAvailable: false });
  await files.upload(alice, initiated.token, bytes, "text/plain");
  const wrongRetry = new TextEncoder().encode("altered file");
  await expect(files.upload(alice, initiated.token, wrongRetry, "text/plain"))
    .rejects.toMatchObject({ code: "conflict" });
  expect((await files.list(alice, "alpha"))[0]).toMatchObject({
    status: "failed",
    failureReason: "stored file content is immutable",
  });
  const immutableRetry = await files.initiate(alice, "alpha", {
    requestKey: "private-one", name: "notes.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength,
  });
  await files.upload(alice, immutableRetry.token, bytes, "text/plain");
  const complete = await files.complete(alice, "alpha", immutableRetry.item.id);
  expect(complete).toMatchObject({ status: "active", previewAvailable: true });
  expect((await files.complete(alice, "alpha", initiated.item.id)).status).toBe("active");

  now = new Date("2026-10-19T01:01:00.000Z");
  const activeRetryOne = await files.initiate(alice, "alpha", {
    requestKey: "private-one", name: "notes.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength,
  });
  const activeRetryTwo = await files.initiate(alice, "alpha", {
    requestKey: "private-one", name: "notes.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength,
  });
  await expect(files.upload(alice, activeRetryOne.token, new Uint8Array([1]), "text/plain"))
    .rejects.toMatchObject({ code: "invalid_input" });
  expect(await registry.ticket(createHash("sha256").update(activeRetryTwo.token).digest("hex"))).not.toBeNull();
  expect((await files.upload(alice, activeRetryTwo.token, bytes, "text/plain")).status).toBe("active");

  expect((await files.list(alice, "alpha")).map((item) => item.id)).toEqual([initiated.item.id]);
  expect(await files.list(bob, "alpha")).toEqual([]);
  await expect(files.remove(bob, "alpha", initiated.item.id)).rejects.toMatchObject({ code: "not_found" });

  const previewTicket = await files.createReadTicket(alice, "alpha", initiated.item.id, "preview");
  expect(new TextDecoder().decode((await files.read(alice, previewTicket.token, "preview")).bytes)).toBe("private file");
  await expect(files.read(bob, previewTicket.token, "preview")).rejects.toMatchObject({ code: "forbidden" });

  await database.query(
    "INSERT INTO platform_personal_file_refs (source_kind, source_id, file_id, created_at) VALUES (?, ?, ?, ?)",
    ["test_session", "session-1", initiated.item.id, now.toISOString()],
  );
  await expect(files.remove(alice, "alpha", initiated.item.id)).rejects.toMatchObject({ code: "conflict" });
  await database.query("DELETE FROM platform_personal_file_refs WHERE file_id = ?", [initiated.item.id]);
  await files.remove(alice, "alpha", initiated.item.id);
  expect(await collectPersonalFileGarbage(registry, objects, now.toISOString())).toEqual({ removed: 1, failed: [] });
  expect(await collectPersonalFileGarbage(registry, objects, now.toISOString())).toEqual({ removed: 0, failed: [] });
  expect(objects.values.size).toBe(0);

  now = new Date("2026-10-19T02:00:00.000Z");
  const staleActive = await files.initiate(alice, "alpha", {
    requestKey: "stale-active", name: "stale.txt", mimeType: "text/plain", sizeBytes: 1,
  });
  await files.upload(alice, staleActive.token, new Uint8Array([1]), "text/plain");
  await files.complete(alice, "alpha", staleActive.item.id);
  const staleRead = await files.createReadTicket(alice, "alpha", staleActive.item.id, "download");
  const stalePending = await files.initiate(alice, "alpha", {
    requestKey: "stale-pending", name: "pending.bin", mimeType: "application/octet-stream", sizeBytes: 1,
  });
  const staleFailed = await files.initiate(alice, "alpha", {
    requestKey: "stale-failed", name: "failed.bin", mimeType: "application/octet-stream", sizeBytes: 2,
  });
  await expect(files.upload(alice, staleFailed.token, new Uint8Array([1]), "application/octet-stream"))
    .rejects.toMatchObject({ code: "invalid_input" });

  await identity.setTenantStatus(admin, "alpha", "disabled");
  await identity.setTenantStatus(admin, "alpha", "active");
  await expect(files.read(alice, staleRead.token, "download"))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(files.upload(alice, stalePending.token, new Uint8Array([1]), "application/octet-stream"))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(files.initiate(alice, "alpha", {
    requestKey: "stale-failed", name: "failed.bin", mimeType: "application/octet-stream", sizeBytes: 2,
  })).rejects.toMatchObject({ code: "conflict", message: "request key belongs to a prior Tenant authority epoch" });
  expect(await files.list(alice, "alpha")).toEqual([]);

  expect(await registry.ticket(createHash("sha256").update(stalePending.token).digest("hex"))).not.toBeNull();
  now = new Date("2026-10-19T02:11:00.000Z");
  expect(await collectPersonalFileGarbage(registry, objects, now.toISOString())).toEqual({ removed: 0, failed: [] });
  expect(await registry.ticket(createHash("sha256").update(stalePending.token).digest("hex"))).toBeNull();

  const retained = await files.initiate(alice, "alpha", {
    requestKey: "retained", name: "retained.bin", mimeType: "application/octet-stream", sizeBytes: 1,
  });
  await identity.deleteTenant(admin, "alpha");
  expect(await database.query("SELECT id FROM platform_personal_files WHERE id = ?", [retained.item.id])).toHaveLength(1);
  await expect(files.list(alice, "alpha")).rejects.toMatchObject({ code: "forbidden" });
}

test("SQLite personal files enforce human ownership, preview, soft delete and idempotent GC", async () => {
  await verifyPersonalFiles(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)("PostgreSQL personal files match the SQLite contract", async () => {
  const admin = openPostgresPlatformDatabase(postgresUrl!);
  const name = `agwmngr_personal_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresUrl!); url.pathname = `/${name}`;
  const database = openPostgresPlatformDatabase(url.toString());
  try { await verifyPersonalFiles(database); }
  finally { await database.close(); await admin.query(`DROP DATABASE ${name}`); await admin.close(); }
}, 30_000);
