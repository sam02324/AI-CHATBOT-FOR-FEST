import type postgres from "postgres";

export function migrate(sql: postgres.Sql): Promise<string[]>;
