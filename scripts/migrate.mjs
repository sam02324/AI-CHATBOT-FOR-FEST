// Applies any new files in db/migrations, once each and in order.
// Vercel runs this before each build (see vercel.json). If it fails, the build fails and the
// current version stays live. Keep migrations additive, because the old version keeps serving
// traffic against the new schema until the build finishes.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, "..", "db", "migrations");

// Everything runs in one transaction, so a failed migration leaves nothing half applied.
// A transaction-level lock also works through connection poolers, so two deploys can't overlap.
export async function migrate(sql) {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  return sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(727401)");
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const rows = await tx.unsafe("SELECT version FROM schema_migrations");
    const done = new Set(rows.map((row) => row.version));
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      await tx.unsafe("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      applied.push(file);
    }
    return applied;
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.VERCEL_ENV === "production") {
      console.error("DATABASE_URL is not set, so the database can't be updated. Stopping this deployment.");
      process.exit(1);
    }
    console.warn("DATABASE_URL is not set, so no migrations were run.");
    return;
  }
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require", onnotice: () => {} });
  try {
    const applied = await migrate(sql);
    console.log(applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is already up to date.");
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
}
