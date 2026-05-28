// Read the last N audit_log rows directly. Used to verify CLI/MCP tagging.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function loadEnv(path) {
  try {
    const t = await readFile(path, "utf8");
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {}
}
await loadEnv(".env.local");

const url =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await sb
  .from("audit_log")
  .select("created_at, actor_id, action, target_type, target_id, metadata")
  .order("created_at", { ascending: false })
  .limit(Number(process.argv[2] ?? 10));
if (error) {
  console.error(error);
  process.exit(1);
}
for (const r of data ?? []) {
  const src = r.metadata?.source ?? "?";
  const mode = r.metadata?.mode ?? "?";
  console.log(
    `${r.created_at}  src=${src.padEnd(4)} mode=${mode.padEnd(7)} ` +
      `${r.action.padEnd(8)} ${r.target_type.padEnd(9)} ${r.target_id ?? "-"}`,
  );
  const md = { ...r.metadata };
  delete md.source;
  delete md.mode;
  if (Object.keys(md).length) {
    console.log(`    ${JSON.stringify(md)}`);
  }
}
