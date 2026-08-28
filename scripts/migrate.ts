/**
 * Applies db/schema.sql. Idempotent, so running it twice is safe and running it
 * against an existing database only adds what is missing.
 *
 *   npm run migrate
 */
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local or pass it inline.");
  process.exit(1);
}

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20 });

try {
  await sql.unsafe(schema);
  const tables = await sql<Array<{ table_name: string }>>`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_name like 'recall_%'
     order by table_name
  `;
  console.log("Schema applied. Tables present:");
  for (const t of tables) console.log(`  ${t.table_name}`);
} catch (error) {
  console.error("Migration failed:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
