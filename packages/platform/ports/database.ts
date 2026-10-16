export type SqlValue = string | number | null;

export interface DatabaseSession {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    values?: SqlValue[],
  ): Promise<T[]>;
}

export interface PlatformDatabase extends DatabaseSession {
  readonly dialect: "sqlite" | "postgres";
  transaction<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T>;
}
