// Mint a magic-link URL for an existing user without sending an email.
// Useful when the email provider (Mimecast, Proofpoint, etc.) quarantines
// Supabase's built-in SMTP and links expire before release.
//
// Usage:  npm run loginlink <email>
//
// The script prints a URL to the terminal — paste it into the browser to sign in.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run loginlink <email>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!url || !key) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) first.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  });

  if (error || !data.properties) {
    console.error("generateLink failed:", error?.message);
    process.exit(1);
  }

  // generateLink's default action_link routes through Supabase's /auth/v1/verify,
  // which uses the implicit (hash-fragment) flow — the server can't read fragments,
  // so the PKCE callback at /auth/callback gets no `code` query param. Skip the
  // verify endpoint and hand the token_hash directly to our /auth/confirm route,
  // which calls verifyOtp server-side.
  const link = new URL(`${appUrl}/auth/confirm`);
  link.searchParams.set("token_hash", data.properties.hashed_token);
  link.searchParams.set("type", "magiclink");
  link.searchParams.set("next", "/");

  console.log("\nSign-in link (paste into your browser):\n");
  console.log(link.toString());
  console.log("\nThis link is single-use and expires in ~1 hour.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
