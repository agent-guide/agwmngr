import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCommandEnv, requireCommandEnvIsolation } from "../lib/server-env";
import { collectCutoverInventory } from "./cutover-operations";

requireCommandEnvIsolation();

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const managerDbPath = resolve(
  option("--manager-db") || getCommandEnv("MANAGER_DB_PATH") || join(process.cwd(), "data", "manager.db"),
);
if (!existsSync(managerDbPath)) throw new Error(`manager database does not exist: ${managerDbPath}`);

const inventory = await collectCutoverInventory({
  managerDbPath,
  objectDir: resolve(
    option("--objects") || getCommandEnv("PLATFORM_OBJECT_DIR") || join(process.cwd(), "data", "objects"),
  ),
  platformDatabaseUrl: getCommandEnv("PLATFORM_DATABASE_URL"),
});
console.log(JSON.stringify(inventory, null, 2));
if (inventory.violations.length > 0) process.exitCode = 1;
