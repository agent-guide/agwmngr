import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getServerEnv } from "./server-env";
import {
  ObjectStoreConflictError,
  type ObjectStore,
  type StoredObjectInfo,
} from "@/packages/platform/ports/objects";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LocalPlatformObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,31}\/[0-9a-f-]{36}$/.test(key)) {
      throw new Error("invalid object key");
    }
    return join(this.root, ...key.split("/"));
  }

  async put(key: string, bytes: Uint8Array): Promise<StoredObjectInfo> {
    const target = this.path(key);
    const info = { sizeBytes: bytes.byteLength, contentHash: sha256(bytes) };
    try {
      const existing = await this.read(key);
      if (existing.byteLength !== info.sizeBytes || sha256(existing) !== info.contentHash) {
        throw new ObjectStoreConflictError();
      }
      return info;
    } catch (error) {
      if (error instanceof ObjectStoreConflictError) throw error;
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, target);
      await rm(temporary, { force: true });
    } catch {
      await rm(temporary, { force: true });
      const existing = await this.read(key);
      if (existing.byteLength !== info.sizeBytes || sha256(existing) !== info.contentHash) {
        throw new ObjectStoreConflictError();
      }
    }
    return info;
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const details = await stat(this.path(key));
      if (!details.isFile()) return null;
      const bytes = await this.read(key);
      return { sizeBytes: details.size, contentHash: sha256(bytes) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

const state = globalThis as typeof globalThis & { __platformObjects?: ObjectStore };

export function getPlatformObjects(): ObjectStore {
  if (!state.__platformObjects) {
    state.__platformObjects = new LocalPlatformObjectStore(
      getServerEnv("PLATFORM_OBJECT_DIR") || join(process.cwd(), "data", "objects"),
    );
  }
  return state.__platformObjects;
}
