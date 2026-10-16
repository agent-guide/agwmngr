import { createRequire } from "node:module";
import { openDatabase, type SqlConnection } from "./sqlite";
import type {
  DatabaseSession,
  PlatformDatabase,
  SqlValue,
} from "@/packages/platform/ports/database";

// SQLite calls on one adapter are serialized so an async domain transaction
// holds the connection until its work commits or rolls back.
export function sqlitePlatformDatabase(connection: SqlConnection): PlatformDatabase {
  let tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  }

  const direct: DatabaseSession = {
    async query<T extends object>(sql: string, values: SqlValue[] = []): Promise<T[]> {
      return connection.all<T>(sql, values);
    },
  };

  return {
    dialect: "sqlite",
    query: (sql, values) => exclusive(() => direct.query(sql, values)),
    transaction: (work) =>
      exclusive(async () => {
        connection.exec("BEGIN IMMEDIATE");
        try {
          const result = await work(direct);
          connection.exec("COMMIT");
          return result;
        } catch (error) {
          connection.exec("ROLLBACK");
          throw error;
        }
      }),
  };
}

export function openSqlitePlatformDatabase(path: string): PlatformDatabase {
  const connection = openDatabase(path);
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA busy_timeout = 5000");
  return sqlitePlatformDatabase(connection);
}

export function openPostgresPlatformDatabase(
  url: string,
): PlatformDatabase & { close(): Promise<void> } {
  // Computed loading prevents Next's Node-side bundler from resolving Bun's
  // runtime-only SQL client while supported commands still execute under Bun.
  const runtimeRequire = createRequire(import.meta.url);
  const { SQL } = runtimeRequire("bun") as typeof import("bun");
  const client = new SQL(url, { max: 4 });

  function session(sql: Pick<typeof client, "unsafe">): DatabaseSession {
    return {
      async query<T extends object>(statement: string, values: SqlValue[] = []): Promise<T[]> {
        let index = 0;
        const text = statement.replace(/\?/g, () => `$${++index}`);
        if (index !== values.length) throw new Error("SQL parameter count mismatch");
        return Array.from(await sql.unsafe<T[]>(text, values));
      },
    };
  }

  return {
    dialect: "postgres",
    ...session(client),
    transaction: (work) =>
      client.begin((transaction) => work(session(transaction))) as Promise<
        Awaited<ReturnType<typeof work>>
      >,
    close: async () => {
      await client.close();
    },
  };
}
