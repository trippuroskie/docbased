import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Same query as the route
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, space_ids")
    .eq("user_id", "fefadc61-e06a-485d-92f5-9d338aa38576")
    .order("created_at", { ascending: false })
    .limit(50);
  console.log("error:", error);
  console.log("count:", data?.length);
  console.log("sample:", data?.[0]);
}
main().catch((e) => { console.error(e); process.exit(1); });
