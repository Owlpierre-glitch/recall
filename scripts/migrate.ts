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
const local = /^(postgres(ql)?:\/\/)?[^@]*@?(localhost|127\.0\.0\.1)/.test(url);
/**
 * Re-running the migration is expected and safe, and Postgres says so with a
 * NOTICE per object that already existed. postgres.js prints those raw, which
 * fills the screen with what look like errors on an ordinary second run. They
 * are counted instead, and anything that is not an "already exists" notice
 * still gets printed, because that would be worth seeing.
 */
let alreadyPresent = 0;
const sql = postgres(url, {
  prepare: false,
  ssl: local ? false : "require",
  max: 1,
  connect_timeout: 20,
  onnotice: (notice) => {
    if (notice.code === "42P07" || notice.code === "42710") alreadyPresent += 1;
    else console.log(`  notice: ${notice.message}`);
  },
});

try {
  await sql.unsafe(schema);
  const tables = await sql<Array<{ table_name: string }>>`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_name like 'recall_%'
     order by table_name
  `;
  console.log(
    alreadyPresent === 0
      ? "Schema applied."
      : `Schema applied. ${alreadyPresent} object${alreadyPresent === 1 ? " was" : "s were"} already present and left alone.`,
  );
  console.log("Tables present:");
  for (const t of tables) console.log(`  ${t.table_name}`);
} catch (error) {
  console.error("Migration failed:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
