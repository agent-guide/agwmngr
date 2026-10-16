import { describe, expect, test } from "bun:test";
import { migrateDatabase } from "./db";
import { openDatabase } from "./sqlite";

describe("Manager database migrations", () => {
  test("manager user IDs remain reserved after deletion", () => {
    const db = openDatabase(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(db);
    db.run(
      "INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (7, 'existing', 'hash', 'now', 'now')",
    );
    db.run("DELETE FROM users WHERE id = 7");
    expect(Number(db.run("INSERT INTO manager_user_ids DEFAULT VALUES").lastInsertRowid)).toBe(8);
  });

  test("upgrade reserves successful historical user deletion IDs", () => {
    const db = openDatabase(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(db);
    db.exec("DROP TRIGGER reserve_manager_user_id; DROP TABLE manager_user_ids; PRAGMA user_version = 2");
    db.run(
      "INSERT INTO audit_log (ts, method, path, decision, http_status) VALUES ('now', 'DELETE', '/api/admin/users/12', 'allow', 200)",
    );
    db.run(
      "INSERT INTO audit_log (ts, method, path, decision, http_status) VALUES ('now', 'DELETE', '/api/admin/users/99', 'deny', 403)",
    );
    migrateDatabase(db);
    expect(Number(db.run("INSERT INTO manager_user_ids DEFAULT VALUES").lastInsertRowid)).toBe(13);
  });

  test("a fresh database uses only admin/member membership roles", () => {
    const db = openDatabase(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(db);

    const version = db.get<{ user_version: number }>("PRAGMA user_version");
    const schema = db.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_gateways'",
    );
    expect(version?.user_version).toBe(3);
    expect(schema?.sql).toContain("'admin','member'");
    expect(schema?.sql).not.toContain("'operator','viewer'");
  });

  test("existing gateway-wide roles are reduced to member", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        is_platform_admin INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE gateways (id TEXT PRIMARY KEY);
      CREATE TABLE user_gateways (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gateway_id TEXT NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('operator','viewer')),
        PRIMARY KEY (user_id, gateway_id)
      );
      INSERT INTO users (id, is_platform_admin) VALUES (1, 0), (2, 0), (3, 1);
      INSERT INTO gateways (id) VALUES ('prod');
      INSERT INTO user_gateways (user_id, gateway_id, role)
      VALUES (1, 'prod', 'operator'), (2, 'prod', 'viewer'), (3, 'prod', 'operator');
      PRAGMA user_version = 1;
    `);

    migrateDatabase(db);

    expect(db.all("SELECT user_id, role FROM user_gateways ORDER BY user_id")).toEqual([
      { user_id: 1, role: "member" },
      { user_id: 2, role: "member" },
    ]);
    expect(db.all("PRAGMA foreign_key_check")).toEqual([]);
  });
});
