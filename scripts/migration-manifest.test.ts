import { expect, test } from "bun:test";
import manifest from "../packages/platform/migrations/manifest.json";
import { buildMigrationManifest } from "./migration-manifest";

test("checked-in migration manifest matches the executable migrations", () => {
  expect(manifest).toEqual(buildMigrationManifest());
});

test("migration names are stable kebab-case identifiers", () => {
  const generated = buildMigrationManifest();
  for (const schema of [generated.manager, generated.platform]) {
    expect(schema.migrations.map((migration) => migration.version)).toEqual(
      Array.from({ length: schema.schemaVersion }, (_, index) => index + 1),
    );
    for (const migration of schema.migrations) {
      expect(migration.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(migration.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(migration.statementCount).toBeGreaterThan(0);
    }
  }
});
