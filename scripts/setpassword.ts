// Set a password on an existing auth user. Bypasses email entirely.
//
// Usage:  npm run setpassword <email> <password>
//
// Combined with the password field on /login, this is the fastest way to get
// into the app on a corporate network where Supabase's built-in SMTP gets
// quarantined.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: npm run setpassword <email> <password>");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
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

  // Look up user by email.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    perPage: 200,
  });
  if (listErr) {
    console.error("listUsers failed:", listErr.message);
    process.exit(1);
  }
  const target = list.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!target) {
    console.error(
      `No auth user with email ${email}. Create one first (run \`npm run seed ${email}\`).`,
    );
    process.exit(1);
  }

  const { error } = await supabase.auth.admin.updateUserById(target.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("updateUserById failed:", error.message);
    process.exit(1);
  }

  console.log(`Password set for ${email}. Sign in at /login.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
