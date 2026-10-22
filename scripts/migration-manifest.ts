import { createHash } from "node:crypto";
import { MANAGER_MIGRATION_NAMES, MANAGER_MIGRATIONS } from "../lib/db";
import {
  PLATFORM_MIGRATIONS,
  PLATFORM_SCHEMA_VERSION,
} from "../packages/platform/services/identity-migrations";

export interface MigrationManifestEntry {
  version: number;
  name: string;
  statementCount: number;
  sha256: string;
}

export interface MigrationManifest {
  formatVersion: 1;
  manager: {
    dialects: ["sqlite"];
    schemaVersion: number;
    migrations: MigrationManifestEntry[];
  };
  platform: {
    dialects: ["sqlite", "postgres"];
    schemaVersion: number;
    migrations: MigrationManifestEntry[];
  };
}

function digest(statements: readonly string[]): string {
  return createHash("sha256")
    .update(statements.map((statement) => statement.trim()).join("\n-- statement --\n"))
    .digest("hex");
}

export function buildMigrationManifest(): MigrationManifest {
  if (MANAGER_MIGRATION_NAMES.length !== MANAGER_MIGRATIONS.length) {
    throw new Error("manager migration names and scripts have different lengths");
  }
  if (
    PLATFORM_MIGRATIONS.length !== PLATFORM_SCHEMA_VERSION ||
    PLATFORM_MIGRATIONS.some((migration, index) => migration.version !== index + 1)
  ) {
    throw new Error("platform migrations must be contiguous and ordered from version 1");
  }

  return {
    formatVersion: 1,
    manager: {
      dialects: ["sqlite"],
      schemaVersion: MANAGER_MIGRATIONS.length,
      migrations: MANAGER_MIGRATIONS.map((script, index) => ({
        version: index + 1,
        name: MANAGER_MIGRATION_NAMES[index],
        statementCount: 1,
        sha256: digest([script]),
      })),
    },
    platform: {
      dialects: ["sqlite", "postgres"],
      schemaVersion: PLATFORM_SCHEMA_VERSION,
      migrations: PLATFORM_MIGRATIONS.map((migration) => ({
        version: migration.version,
        name: migration.name,
        statementCount: migration.statements.length,
        sha256: digest(migration.statements),
      })),
    },
  };
}

export function serializeMigrationManifest(manifest = buildMigrationManifest()): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
