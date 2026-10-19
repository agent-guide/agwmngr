import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { knowledgeAuditTarget } from "@/lib/platform-knowledge-http";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { ObjectStoreConflictError, type ObjectStore } from "@/packages/platform/ports/objects";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { KnowledgeRegistry } from "@/packages/platform/services/knowledge-registry";
import { KnowledgeService, collectKnowledgeDocumentGarbage } from "@/packages/platform/services/knowledge";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

class MemoryObjects implements ObjectStore {
  readonly values = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    const existing = this.values.get(key);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (existing && createHash("sha256").update(existing).digest("hex") !== hash) {
      throw new ObjectStoreConflictError();
    }
    this.values.set(key, bytes.slice());
    return { sizeBytes: bytes.byteLength, contentHash: hash };
  }
  async stat(key: string) {
    const bytes = this.values.get(key);
    return bytes ? {
      sizeBytes: bytes.byteLength,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    } : null;
  }
  async read(key: string) {
    const bytes = this.values.get(key);
    if (!bytes) throw new Error("missing object");
    return bytes.slice();
  }
  async remove(key: string) { this.values.delete(key); }
}

async function verifyKnowledge(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  let sequence = 0;
  let now = new Date("2026-10-19T00:00:00.000Z");
  const identity = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) { return users.get(id) ?? null; },
      async findUserByUsername(username) { return [...users.values()].find((user) => user.username === username) ?? null; },
      async listUsers() { return [...users.values()]; },
      async findGateway() { return null; },
    },
    { digest: (token) => `digest:${token}`, issue: () => ({ id: "credential:test", token: `agwmngr_svc_${"1".repeat(64)}`, digest: "digest:test" }) },
    { digest: (token) => `receipt:${token}`, issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }) },
    () => now,
  );
  const objects = new MemoryObjects();
  const registry = new KnowledgeRegistry(database);
  const knowledge = new KnowledgeService(registry, identity, objects, {
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
  await identity.createTenant(admin, "beta", "Beta");
  await identity.bootstrapMembership(admin, "alpha", "user:2", "user");
  await identity.bootstrapMembership(admin, "beta", "user:3", "admin");

  const base = await knowledge.create(alice, "alpha", { name: "Runbooks", description: "Operations" });
  expect(base).toMatchObject({ tenantId: "alpha", indexingStatus: "unavailable", retrievalStatus: "unavailable" });
  expect((await knowledge.list(alice, "alpha"))[0].id).toBe(base.id);
  expect(await knowledge.list(bob, "beta")).toEqual([]);
  await expect(knowledge.get(bob, "beta", base.id)).rejects.toMatchObject({ code: "not_found" });

  const content = new TextEncoder().encode("hello knowledge");
  const sessions = await knowledge.initiateUploads(alice, "alpha", base.id, [
    { requestKey: "file-one", name: "guide.txt", mimeType: "text/plain", sizeBytes: content.byteLength },
    { requestKey: "bad-extension", name: "malware.exe", mimeType: "application/octet-stream", sizeBytes: 10 },
  ]);
  expect(sessions).toHaveLength(2);
  expect(sessions[0].ok).toBe(true);
  expect(sessions[1]).toMatchObject({ ok: false, code: "invalid_input" });
  const first = sessions[0];
  if (!first.ok) throw new Error("expected upload session");

  await expect(knowledge.upload(alice, first.token, new Uint8Array([1]), "text/plain"))
    .rejects.toMatchObject({ code: "invalid_input" });
  expect((await knowledge.listDocuments(alice, "alpha", base.id))[0]).toMatchObject({
    status: "failed",
    indexStatus: "unavailable",
  });
  const retry = (await knowledge.initiateUploads(alice, "alpha", base.id, [
    { requestKey: "file-one", name: "guide.txt", mimeType: "text/plain", sizeBytes: content.byteLength },
  ]))[0];
  if (!retry.ok) throw new Error("expected retry session");
  await knowledge.upload(alice, retry.token, content, "text/plain");
  const wrongRetry = new TextEncoder().encode("wrong knowledge");
  await expect(knowledge.upload(alice, retry.token, wrongRetry, "text/plain"))
    .rejects.toMatchObject({ code: "conflict" });
  expect((await knowledge.listDocuments(alice, "alpha", base.id))[0]).toMatchObject({
    status: "failed",
    failureReason: "stored document content is immutable",
  });
  const immutableRetry = (await knowledge.initiateUploads(alice, "alpha", base.id, [
    { requestKey: "file-one", name: "guide.txt", mimeType: "text/plain", sizeBytes: content.byteLength },
  ]))[0];
  if (!immutableRetry.ok) throw new Error("expected immutable-conflict retry session");
  await knowledge.upload(alice, immutableRetry.token, content, "text/plain");
  const completed = await knowledge.complete(alice, "alpha", base.id, immutableRetry.item.id);
  expect(completed).toMatchObject({ status: "active", contentHash: createHash("sha256").update(content).digest("hex") });
  expect((await knowledge.complete(alice, "alpha", base.id, immutableRetry.item.id)).status).toBe("active");

  now = new Date("2026-10-19T01:01:00.000Z");
  const activeRetryOne = (await knowledge.initiateUploads(alice, "alpha", base.id, [{
    requestKey: "file-one", name: "guide.txt", mimeType: "text/plain", sizeBytes: content.byteLength,
  }]))[0];
  const activeRetryTwo = (await knowledge.initiateUploads(alice, "alpha", base.id, [{
    requestKey: "file-one", name: "guide.txt", mimeType: "text/plain", sizeBytes: content.byteLength,
  }]))[0];
  if (!activeRetryOne.ok || !activeRetryTwo.ok) throw new Error("expected active retry sessions");
  await expect(knowledge.upload(alice, activeRetryOne.token, new Uint8Array([1]), "text/plain"))
    .rejects.toMatchObject({ code: "invalid_input" });
  expect(await registry.ticket(createHash("sha256").update(activeRetryTwo.token).digest("hex"))).not.toBeNull();
  expect((await knowledge.upload(alice, activeRetryTwo.token, content, "text/plain")).status).toBe("active");

  await expect(knowledge.downloadTicket(bob, "beta", base.id, immutableRetry.item.id))
    .rejects.toMatchObject({ code: "not_found" });
  const downloadTicket = await knowledge.downloadTicket(alice, "alpha", base.id, immutableRetry.item.id);
  const downloaded = await knowledge.download(alice, downloadTicket.token);
  expect(new TextDecoder().decode(downloaded.bytes)).toBe("hello knowledge");
  expect(await registry.ticket(createHash("sha256").update(downloadTicket.token).digest("hex"))).not.toBeNull();
  now = new Date("2026-10-19T01:07:00.000Z");
  expect(await collectKnowledgeDocumentGarbage(registry, objects, now.toISOString())).toEqual({ removed: 0, failed: [] });
  expect(await registry.ticket(createHash("sha256").update(downloadTicket.token).digest("hex"))).toBeNull();

  await database.query(
    "INSERT INTO platform_knowledge_document_refs (source_kind, source_id, document_id, created_at) VALUES (?, ?, ?, ?)",
    ["test_release", "release-1", completed.id, now.toISOString()],
  );
  await expect(knowledge.deleteDocument(alice, "alpha", base.id, completed.id))
    .rejects.toMatchObject({ code: "conflict" });
  await database.query("DELETE FROM platform_knowledge_document_refs WHERE document_id = ?", [completed.id]);
  await knowledge.deleteDocument(alice, "alpha", base.id, completed.id);
  expect((await knowledge.listDocuments(alice, "alpha", base.id))).toEqual([]);
  expect(await collectKnowledgeDocumentGarbage(registry, objects)).toEqual({ removed: 1, failed: [] });
  expect(objects.values.size).toBe(0);

  now = new Date("2026-10-19T02:00:00.000Z");
  await knowledge.remove(alice, "alpha", base.id);
  expect((await knowledge.get(alice, "alpha", base.id)).status).toBe("archived");
  await expect(knowledge.update(alice, "alpha", base.id, { name: "Changed", description: "" }))
    .rejects.toMatchObject({ code: "not_found" });

  const retained = await knowledge.create(alice, "alpha", { name: "Retained", description: "" });
  await identity.deleteTenant(admin, "alpha");
  expect(await database.query("SELECT id FROM platform_knowledge_bases WHERE id = ?", [retained.id])).toHaveLength(1);
  await expect(knowledge.list(alice, "alpha")).rejects.toMatchObject({ code: "forbidden" });
  await expect(identity.createTenant(admin, "alpha", "Replacement Alpha")).rejects.toMatchObject({ code: "conflict" });
}

test("SQLite knowledge documents support isolated resumable uploads and explicit unavailable indexing", async () => {
  await verifyKnowledge(sqlitePlatformDatabase(openDatabase(":memory:")));
});

test("knowledge audit targets distinguish parent collections from document items", () => {
  expect(knowledgeAuditTarget([])).toEqual({ targetKind: "knowledge_base", targetId: null });
  expect(knowledgeAuditTarget(["knowledge:one", "documents"])).toEqual({
    targetKind: "knowledge_base", targetId: "knowledge:one",
  });
  expect(knowledgeAuditTarget(["knowledge:one", "documents", "upload-sessions"])).toEqual({
    targetKind: "knowledge_base", targetId: "knowledge:one",
  });
  expect(knowledgeAuditTarget(["knowledge:one", "documents", "document:one", "complete"])).toEqual({
    targetKind: "knowledge_document", targetId: "document:one",
  });
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)("PostgreSQL knowledge documents match the SQLite contract", async () => {
  const admin = openPostgresPlatformDatabase(postgresUrl!);
  const name = `agwmngr_knowledge_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresUrl!); url.pathname = `/${name}`;
  const database = openPostgresPlatformDatabase(url.toString());
  try { await verifyKnowledge(database); }
  finally { await database.close(); await admin.query(`DROP DATABASE ${name}`); await admin.close(); }
}, 30_000);
