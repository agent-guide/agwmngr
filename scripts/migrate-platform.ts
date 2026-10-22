import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCommandEnv, requireCommandEnvIsolation } from "../lib/server-env";
import { openDatabase } from "../lib/sqlite";
import {
  openPostgresPlatformDatabase,
  sqlitePlatformDatabase,
} from "../lib/platform-database";
import { migratePlatformIdentityDatabase } from "../packages/platform/services/identity-migrations";

requireCommandEnvIsolation();

const apply = process.argv.includes("--apply");
const invalid = process.argv.slice(2).some((argument) => !["--apply", "--dry-run"].includes(argument));
if (invalid || (apply && process.argv.includes("--dry-run"))) {
  throw new Error("usage: bun scripts/migrate-platform.ts [--dry-run | --apply]");
}

const managerPath =
  getCommandEnv("MANAGER_DB_PATH") || join(process.cwd(), "data", "manager.db");
if (!existsSync(managerPath)) {
  throw new Error("initialize the manager database before the platform identity migration");
}

const manager = openDatabase(managerPath);
manager.exec("PRAGMA foreign_keys = ON");
manager.exec("PRAGMA busy_timeout = 5000");
const databaseUrl = getCommandEnv("PLATFORM_DATABASE_URL");
const postgres = databaseUrl ? openPostgresPlatformDatabase(databaseUrl) : null;
const database = postgres ?? sqlitePlatformDatabase(manager);

try {
  const schema = await migratePlatformIdentityDatabase(database, !apply);
  const managerUsers = manager.get<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n ?? 0;
  console.log(
    JSON.stringify(
      {
        backend: database.dialect,
        schema,
        managerUsers: Number(managerUsers),
        humanCredentialsCopied: false,
      },
      null,
      2,
    ),
  );
} finally {
  await postgres?.close();
}
