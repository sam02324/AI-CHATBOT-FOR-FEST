import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { migrate } from "../scripts/migrate.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

// A real Postgres engine in this process, on a free localhost port, so no service has to be installed.
// The server allows only one connection unless told otherwise, and refuses the rest.
export default async function setup(project: TestProject) {
  const engine = await PGlite.create();
  const server = new PGLiteSocketServer({ db: engine, host: "127.0.0.1", port: 0, maxConnections: 10 });
  await server.start();

  const url = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
  const sql = postgres(url, { max: 1, prepare: false, ssl: false, onnotice: () => {} });
  await migrate(sql);
  await sql.end();
  project.provide("testDatabaseUrl", url);

  return async () => {
    await server.stop();
    await engine.close();
  };
}
