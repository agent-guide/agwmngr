// Minimal synchronous SQLite adapter that runs on either runtime.
//
// The manager's Next.js server runs under Node.js (even when launched via Bun,
// `next dev`/`next start` execute under the Node runtime), where `bun:sqlite`
// is unavailable. Node 22.5+ ships a built-in `node:sqlite` (`DatabaseSync`)
// with a near-identical API. When the process genuinely runs under Bun, we use
// `bun:sqlite` instead. This adapter normalizes both to one small interface so
// the rest of the codebase is runtime-agnostic.
import { createRequire } from "module";

export interface SqlStatement {
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface SqlConnection {
  exec(sql: string): void; // run one or more statements (DDL/migrations)
  prepare(sql: string): SqlStatement;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  transaction(fn: () => void): void;
}

// Computed module name keeps the bundler from trying to resolve `bun:sqlite`
// at build time on a Node toolchain (it would fail). createRequire gives us a
// CommonJS require even inside an ESM module.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const nodeRequire = createRequire(import.meta.url);

// Minimal structural types for node:sqlite — @types/node@20 predates it, so we
// describe just the surface we use rather than depend on the bundled typings.
interface NodeRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}
interface NodeStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): NodeRunResult;
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeDatabase;
}

export function openDatabase(path: string): SqlConnection {
  return isBun ? openBun(path) : openNode(path);
}

function openNode(path: string): SqlConnection {
  const { DatabaseSync } = nodeRequire("node:sqlite") as NodeSqliteModule;
  const db = new DatabaseSync(path);

  const wrapStmt = (sql: string): SqlStatement => {
    const stmt = db.prepare(sql);
    return {
      get: <T,>(...p: unknown[]) => stmt.get(...(p as never[])) as T | undefined,
      all: <T,>(...p: unknown[]) => stmt.all(...(p as never[])) as T[],
      run: (...p: unknown[]) => {
        const r = stmt.run(...(p as never[]));
        return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
      },
    };
  };

  return {
    exec: (sql) => db.exec(sql),
    prepare: wrapStmt,
    run: (sql, params = []) => wrapStmt(sql).run(...params),
    get: <T,>(sql: string, params: unknown[] = []) => wrapStmt(sql).get<T>(...params),
    all: <T,>(sql: string, params: unknown[] = []) => wrapStmt(sql).all<T>(...params),
    transaction: (fn) => {
      db.exec("BEGIN");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

function openBun(path: string): SqlConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Database } = nodeRequire("bun:sqlite") as any;
  const db = new Database(path, { create: true });

  const wrapStmt = (sql: string): SqlStatement => {
    const stmt = db.query(sql);
    return {
      get: <T,>(...p: unknown[]) => stmt.get(...p) as T | undefined,
      all: <T,>(...p: unknown[]) => stmt.all(...p) as T[],
      run: (...p: unknown[]) => {
        const r = stmt.run(...p);
        return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid ?? 0 };
      },
    };
  };

  return {
    exec: (sql) => db.run(sql),
    prepare: wrapStmt,
    run: (sql, params = []) => wrapStmt(sql).run(...params),
    get: <T,>(sql: string, params: unknown[] = []) => wrapStmt(sql).get<T>(...params),
    all: <T,>(sql: string, params: unknown[] = []) => wrapStmt(sql).all<T>(...params),
    transaction: (fn) => db.transaction(fn)(),
  };
}
