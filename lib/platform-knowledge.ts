import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformObjects } from "./platform-object-store";
import { KnowledgeRegistry } from "@/packages/platform/services/knowledge-registry";
import { KnowledgeService } from "@/packages/platform/services/knowledge";

const state = globalThis as typeof globalThis & { __platformKnowledge?: Promise<KnowledgeService> };

export function getPlatformKnowledge(): Promise<KnowledgeService> {
  if (!state.__platformKnowledge) {
    state.__platformKnowledge = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new KnowledgeService(
        new KnowledgeRegistry(database),
        identity,
        getPlatformObjects(),
        {
          id: () => randomUUID(),
          now: () => new Date().toISOString(),
          hash: (value) => createHash("sha256").update(value).digest("hex"),
          hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
          decodeBase64: (value) => Buffer.from(value, "base64"),
          encodeBase64: (value) => Buffer.from(value).toString("base64"),
        },
      );
    })().catch((error) => {
      delete state.__platformKnowledge;
      throw error;
    });
  }
  return state.__platformKnowledge;
}
