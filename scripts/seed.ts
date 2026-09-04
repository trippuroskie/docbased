// One-shot seed: creates the first admin user, an "IT" space, and an "Ecomm" space.
// Run after applying migrations: `npm run seed <admin-email>`
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/seed.ts <admin-email>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) first.",
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data: invite, error } = await supabase.auth.admin.inviteUserByEmail(email);
  if (error || !invite.user) {
    console.error("Invite failed:", error?.message);
    process.exit(1);
  }
  const userId = invite.user.id;

  await supabase.from("users").upsert({ id: userId, email, is_admin: true });

  const spaces = [
    { slug: "it", name: "IT", description: "IT operations, runbooks, and infrastructure docs." },
    { slug: "ecomm", name: "Ecomm", description: "Ecommerce playbooks, analytics, and Shopify docs." },
    { slug: "notes", name: "Notes", description: "Personal capture space." },
  ];

  for (const s of spaces) {
    const { data, error: serr } = await supabase
      .from("spaces")
      .upsert(s, { onConflict: "slug" })
      .select("id")
      .single();
    if (serr || !data) {
      console.error("space upsert failed:", serr?.message);
      continue;
    }
    await supabase
      .from("space_access")
      .upsert(
        { space_id: data.id, user_id: userId, role: "owner" },
        { onConflict: "space_id,user_id" },
      );
  }

  console.log(`Seeded admin user ${email} (id ${userId}) with owner access to IT, Ecomm, Notes.`);
  console.log("Magic link delivered to your inbox — click it to sign in.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
