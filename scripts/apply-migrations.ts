// Apply SQL files in supabase/migrations/ in lexical order against DATABASE_URL.
// Idempotent: each migration is wrapped in a single transaction and the
// migration name is recorded in a "_kb_migrations" table.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const sql = postgres(url, { prepare: false, max: 1 });
  await sql`create table if not exists _kb_migrations (
    name text primary key,
    applied_at timestamptz default now()
  )`;

  const dir = join(process.cwd(), "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
      select count(*)::int as count from _kb_migrations where name = ${file}
    `;
    if (count > 0) {
      console.log(`SKIP ${file} (already applied)`);
      continue;
    }
    const text = await readFile(join(dir, file), "utf8");
    console.log(`APPLY ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into _kb_migrations (name) values (${file})`;
    });
  }

  await sql.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
