import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { serializeMigrationManifest } from "./migration-manifest";

const target = join(import.meta.dir, "..", "packages", "platform", "migrations", "manifest.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, serializeMigrationManifest(), { encoding: "utf8", mode: 0o644 });
console.log(`generated ${target}`);
