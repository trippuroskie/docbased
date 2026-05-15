// Weekly pg_dump backup. Intended to run via Vercel Cron or a host cron job.
// Reads DATABASE_URL, dumps to /tmp, uploads to the Supabase Storage "backups"
// bucket (create it once: `supabase storage create backups --private`).
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";

const exec = promisify(execFile);

async function main() {
  const url = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !supabaseUrl || !secretKey) {
    throw new Error(
      "DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) required.",
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(tmpdir(), `kb-${stamp}.sql`);

  await exec("pg_dump", ["--format=plain", "--no-owner", "--no-privileges", "--file", file, url]);
  const body = await readFile(file);

  const supabase = createClient(supabaseUrl, secretKey);
  const { error } = await supabase.storage
    .from("backups")
    .upload(`weekly/kb-${stamp}.sql`, body, {
      contentType: "application/sql",
      upsert: false,
    });
  if (error) throw error;

  await unlink(file);
  console.log(`Uploaded weekly/kb-${stamp}.sql`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
