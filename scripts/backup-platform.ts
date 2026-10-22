import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCommandEnv, requireCommandEnvIsolation } from "../lib/server-env";
import { createCutoverBackup } from "./cutover-operations";

requireCommandEnvIsolation();

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outputDir = option("--output");
const acknowledged = process.argv.includes("--writers-stopped");
const known = new Set(["--output", "--manager-db", "--objects", "--writers-stopped"]);
const invalid = process.argv.slice(2).some((argument, index, all) =>
  argument.startsWith("--") && !known.has(argument) ||
  (!argument.startsWith("--") && !known.has(all[index - 1]))
);
if (!outputDir || !acknowledged || invalid) {
  throw new Error(
    "usage: bun scripts/backup-platform.ts --output DIR --writers-stopped " +
      "[--manager-db FILE] [--objects DIR]",
  );
}

const managerDbPath = resolve(
  option("--manager-db") || getCommandEnv("MANAGER_DB_PATH") || join(process.cwd(), "data", "manager.db"),
);
if (!existsSync(managerDbPath)) throw new Error(`manager database does not exist: ${managerDbPath}`);

const manifest = await createCutoverBackup({
  managerDbPath,
  objectDir: resolve(
    option("--objects") || getCommandEnv("PLATFORM_OBJECT_DIR") || join(process.cwd(), "data", "objects"),
  ),
  outputDir,
  platformDatabaseUrl: getCommandEnv("PLATFORM_DATABASE_URL"),
});
console.log(JSON.stringify(manifest, null, 2));
