import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformObjects } from "./platform-object-store";
import { PersonalFileRegistry } from "@/packages/platform/services/personal-file-registry";
import { PersonalFileService } from "@/packages/platform/services/personal-files";

const state = globalThis as typeof globalThis & { __platformPersonalFiles?: Promise<PersonalFileService> };

export function getPlatformPersonalFiles(): Promise<PersonalFileService> {
  if (!state.__platformPersonalFiles) {
    state.__platformPersonalFiles = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new PersonalFileService(
        new PersonalFileRegistry(database),
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
      delete state.__platformPersonalFiles;
      throw error;
    });
  }
  return state.__platformPersonalFiles;
}
