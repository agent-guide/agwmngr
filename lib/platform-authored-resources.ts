import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { AuthoredResourceRegistry } from "@/packages/platform/services/authored-resource-registry";
import { AuthoredResourceService } from "@/packages/platform/services/authored-resources";

const state = globalThis as typeof globalThis & {
  __platformAuthoredResources?: Promise<AuthoredResourceService>;
};

export function getPlatformAuthoredResources(): Promise<AuthoredResourceService> {
  if (!state.__platformAuthoredResources) {
    state.__platformAuthoredResources = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new AuthoredResourceService(
        new AuthoredResourceRegistry(database),
        identity,
        {
          id: () => randomUUID(),
          now: () => new Date().toISOString(),
          hash: (value) => createHash("sha256").update(value).digest("hex"),
          hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
          decodeBase64(value) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
              throw new Error("invalid base64");
            }
            return Buffer.from(value, "base64");
          },
          encodeBase64: (value) => Buffer.from(value).toString("base64"),
        },
      );
    })().catch((error) => {
      delete state.__platformAuthoredResources;
      throw error;
    });
  }
  return state.__platformAuthoredResources;
}
