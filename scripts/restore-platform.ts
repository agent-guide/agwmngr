import { join, resolve } from "node:path";
import { getCommandEnv, requireCommandEnvIsolation } from "../lib/server-env";
import { restoreCutoverBackup } from "./cutover-operations";

requireCommandEnvIsolation();

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDir = option("--backup");
const managerDbPath = option("--manager-db");
const objectDir = option("--objects");
const apply = process.argv.includes("--apply");
const acknowledged = process.argv.includes("--writers-stopped");
const known = new Set(["--backup", "--manager-db", "--objects", "--apply", "--writers-stopped"]);
const invalid = process.argv.slice(2).some((argument, index, all) =>
  argument.startsWith("--") && !known.has(argument) ||
  (!argument.startsWith("--") && !known.has(all[index - 1]))
);
if (!backupDir || !managerDbPath || !objectDir || !apply || !acknowledged || invalid) {
  throw new Error(
    "usage: bun scripts/restore-platform.ts --backup DIR --manager-db NEW_FILE " +
      "--objects NEW_DIR --apply --writers-stopped",
  );
}

const inventory = await restoreCutoverBackup({
  backupDir: resolve(backupDir),
  managerDbPath: resolve(managerDbPath || join(process.cwd(), "data", "restored.db")),
  objectDir: resolve(objectDir),
  platformDatabaseUrl: getCommandEnv("PLATFORM_DATABASE_URL"),
});
console.log(JSON.stringify(inventory, null, 2));
