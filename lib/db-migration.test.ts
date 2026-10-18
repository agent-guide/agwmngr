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
    db.exec(`
      DROP TRIGGER reserve_manager_user_id;
      DROP TRIGGER initialize_manager_user_authority;
      DROP TRIGGER reserve_manager_gateway_id;
      DROP TABLE manager_user_ids;
      DROP TABLE manager_gateway_ids;
      DROP TABLE manager_authority_fences;
      ALTER TABLE audit_log DROP COLUMN actor_principal_id;
      ALTER TABLE audit_log DROP COLUMN tenant_id;
      ALTER TABLE audit_log DROP COLUMN effective_access;
      PRAGMA user_version = 2;
    `);
    db.run(
      "INSERT INTO audit_log (ts, method, path, decision, http_status) VALUES ('now', 'DELETE', '/api/admin/users/12', 'allow', 200)",
    );
    db.run(
      "INSERT INTO audit_log (ts, method, path, decision, http_status) VALUES ('now', 'DELETE', '/api/admin/users/99', 'deny', 403)",
    );
    db.run(
      "INSERT INTO audit_log (ts, method, path, decision, http_status) VALUES ('now', 'DELETE', '/api/admin/gateways/retired', 'allow', 200)",
    );
    migrateDatabase(db);
    expect(Number(db.run("INSERT INTO manager_user_ids DEFAULT VALUES").lastInsertRowid)).toBe(13);
    expect(
      db.get<{ id: string }>("SELECT id FROM manager_gateway_ids WHERE id = 'retired'"),
    ).toEqual({ id: "retired" });
  });

  test("a fresh database uses only admin/member membership roles", () => {
    const db = openDatabase(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(db);

    const version = db.get<{ user_version: number }>("PRAGMA user_version");
    const schema = db.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_gateways'",
    );
    expect(version?.user_version).toBe(4);
    expect(schema?.sql).toContain("'admin','member'");
    expect(schema?.sql).not.toContain("'operator','viewer'");
  });

  test("existing gateway-wide roles are reduced to member", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        is_platform_admin INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE gateways (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE user_gateways (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gateway_id TEXT NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('operator','viewer')),
        PRIMARY KEY (user_id, gateway_id)
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        method TEXT,
        path TEXT,
        decision TEXT NOT NULL,
        http_status INTEGER
      );
      INSERT INTO users (id, is_platform_admin, updated_at)
      VALUES (1, 0, 'now'), (2, 0, 'now'), (3, 1, 'now');
      INSERT INTO gateways (id, created_at, updated_at) VALUES ('prod', 'now', 'now');
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

  test("Gateway IDs and authority epochs survive deletion", () => {
    const db = openDatabase(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(db);
    db.run(
      `INSERT INTO gateways
         (id, name, admin_addr, admin_user, admin_password_enc, status, created_at, updated_at)
       VALUES ('prod', 'Production', 'http://localhost:1', 'admin', 'ciphertext',
               'active', 'now', 'now')`,
    );
    expect(
      db.get<{ authority_epoch: number }>("SELECT authority_epoch FROM manager_authority_fences WHERE subject_kind = 'gateway' AND subject_id = 'prod'"),
    ).toEqual({ authority_epoch: 1 });
    expect(() =>
      db.run(
        `INSERT INTO gateways
           (id, name, admin_addr, admin_user, admin_password_enc, status, created_at, updated_at)
         VALUES ('prod', 'Duplicate', 'http://localhost:2', 'admin', 'ciphertext',
                 'active', 'now', 'now')`,
      ),
    ).toThrow();

    db.run("UPDATE manager_gateway_ids SET tombstoned_at = 'later' WHERE id = 'prod'");
    db.run("DELETE FROM gateways WHERE id = 'prod'");
    expect(() =>
      db.run(
        `INSERT INTO gateways
           (id, name, admin_addr, admin_user, admin_password_enc, status, created_at, updated_at)
         VALUES ('prod', 'Replacement', 'http://localhost:3', 'admin', 'ciphertext',
                 'active', 'later', 'later')`,
      ),
    ).toThrow();
    expect(
      db.get<{ tombstoned_at: string }>("SELECT tombstoned_at FROM manager_gateway_ids WHERE id = 'prod'"),
    ).toEqual({ tombstoned_at: "later" });
  });
});
