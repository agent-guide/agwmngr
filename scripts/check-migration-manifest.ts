import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeMigrationManifest } from "./migration-manifest";

const target = join(import.meta.dir, "..", "packages", "platform", "migrations", "manifest.json");
const checkedIn = await readFile(target, "utf8");
const generated = serializeMigrationManifest();
if (checkedIn !== generated) {
  throw new Error("migration manifest is stale; run `bun run generate:migrations`");
}
console.log("migration manifest is current");
