import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectStoreConflictError } from "@/packages/platform/ports/objects";
import { LocalPlatformObjectStore } from "./platform-object-store";

test("local object storage preserves immutable bytes and reports replacement conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "agwmngr-objects-"));
  try {
    const store = new LocalPlatformObjectStore(root);
    const key = "documents/00000000-0000-4000-8000-000000000001";
    const original = new TextEncoder().encode("original");
    const replacement = new TextEncoder().encode("replaced");

    expect(await store.put(key, original)).toMatchObject({ sizeBytes: original.byteLength });
    expect(await store.put(key, original)).toMatchObject({ sizeBytes: original.byteLength });
    await expect(store.put(key, replacement)).rejects.toBeInstanceOf(ObjectStoreConflictError);
    expect(new TextDecoder().decode(await store.read(key))).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
