import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: users } = await supabase
    .from("users")
    .select("id, email, display_name, is_admin");
  console.log("users:");
  for (const u of users ?? []) {
    console.log(
      `  ${u.is_admin ? "[admin]" : "       "} ${u.email}${u.display_name ? ` "${u.display_name}"` : ""} id=${u.id}`,
    );
  }

  const { data: spaces } = await supabase.from("spaces").select("id, name");
  console.log("\nspaces:");
  for (const s of spaces ?? []) console.log(`  ${s.name} id=${s.id}`);

  const { data: access } = await supabase
    .from("space_access")
    .select("user_id, space_id, role");
  console.log("\nspace_access:");
  for (const a of access ?? [])
    console.log(`  user=${a.user_id} space=${a.space_id} role=${a.role}`);
}
main();
