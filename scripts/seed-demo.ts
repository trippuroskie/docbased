// Seeds synthetic demo content for screenshots and for trying the app without
// touching real documents: three spaces, eight documents, and one NON-ADMIN
// demo user.
//
// The demo user is deliberately not an admin. getAccessibleSpaces() grants
// admins every space (src/lib/auth.ts), so screenshotting as an admin would
// put your real space names in the sidebar. A non-admin sees only the three
// demo spaces granted below.
//
// Usage: npm run seed:demo
// Clean up afterwards with: npm run seed:demo -- --purge
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

type Sb = ReturnType<typeof serviceClient>;

const DEMO_EMAIL = "demo@northwind.example";
// No default: a committed default password would create a known-credential
// auth user in whatever project this is pointed at, production included.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const CONTENT_DIR =
  process.env.DEMO_CONTENT_DIR ?? path.join(process.cwd(), "scripts", "demo-content");

const SPACES = [
  { slug: "demo-engineering", name: "Engineering", description: "Runbooks, architecture notes, and onboarding for the platform team." },
  { slug: "demo-support", name: "Support", description: "Macros, policies, and troubleshooting trees for the support desk." },
  { slug: "demo-handbook", name: "Handbook", description: "Company-wide policy: time off, security, and working agreements." },
];

const DOCS = [
  { file: "incident-response.md", space: "demo-engineering", folder: "Runbooks", tags: ["oncall", "runbook", "sev1"] },
  { file: "database-failover.md", space: "demo-engineering", folder: "Runbooks", tags: ["runbook", "postgres", "database"] },
  { file: "retrieval-pipeline.md", space: "demo-engineering", folder: "Architecture", tags: ["architecture", "search", "rag"] },
  { file: "dev-environment.md", space: "demo-engineering", folder: "Onboarding", tags: ["onboarding", "tooling"] },
  { file: "refund-policy.md", space: "demo-support", folder: "Policies", tags: ["support", "policy", "billing"] },
  { file: "login-issues.md", space: "demo-support", folder: "Troubleshooting", tags: ["support", "auth", "troubleshooting"] },
  { file: "pto-policy.md", space: "demo-handbook", folder: "", tags: ["handbook", "pto", "benefits"] },
  { file: "security-basics.md", space: "demo-handbook", folder: "", tags: ["handbook", "security", "mfa"] },
];

/**
 * Remove everything seed() created. Order matters:
 *   1. audit_log + documents reference users(id) WITHOUT on-delete-cascade, so
 *      the spaces (and their documents) must go before the user.
 *   2. Deleting a space cascades to documents → chunks, links, space_access.
 *   3. Deleting the auth user cascades to users → conversations,
 *      user_settings, mcp_tokens.
 * Storage objects are not covered by any FK, so they're removed explicitly.
 */
async function purge(sb: Sb) {
  const { data: spaces } = await sb
    .from("spaces")
    .select("id, slug")
    .in("slug", SPACES.map((s) => s.slug));

  for (const sp of spaces ?? []) {
    const spaceId = sp.id as string;
    // Storage is laid out as <spaceId>/<documentId>/<filename>.
    const { data: docDirs } = await sb.storage.from("originals").list(spaceId);
    for (const dir of docDirs ?? []) {
      const { data: files } = await sb.storage
        .from("originals")
        .list(`${spaceId}/${dir.name}`);
      const paths = (files ?? []).map((f) => `${spaceId}/${dir.name}/${f.name}`);
      if (paths.length) await sb.storage.from("originals").remove(paths);
    }
  }

  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const demo = list?.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
  if (demo) {
    await sb.from("audit_log").delete().eq("actor_id", demo.id);
  }

  await sb.from("spaces").delete().in("slug", SPACES.map((s) => s.slug));
  console.log(`removed ${(spaces ?? []).length} demo space(s) and their documents`);

  if (demo) {
    const { error } = await sb.auth.admin.deleteUser(demo.id);
    if (error) console.error("could not delete demo auth user:", error.message);
    else console.log(`removed demo user ${DEMO_EMAIL}`);
  }
}

async function main() {
  const sb = serviceClient();

  if (process.argv.includes("--purge")) {
    await purge(sb);
    return;
  }

  if (!DEMO_PASSWORD) {
    console.error(
      "Set DEMO_PASSWORD to the password you want the demo user to have, e.g.\n" +
        "  DEMO_PASSWORD=$(openssl rand -base64 18) npm run seed:demo",
    );
    process.exit(1);
  }

  // 1. demo auth user (non-admin: admins see every space, which would leak real ones)
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  let userId = list?.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL)?.id;
  if (!userId) {
    const { data, error } = await sb.auth.admin.createUser({
      email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true,
    });
    if (error) throw error;
    userId = data.user!.id;
    console.log("created auth user", DEMO_EMAIL);
  } else {
    await sb.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
    console.log("reused auth user", DEMO_EMAIL);
  }
  await sb.from("users").upsert({ id: userId, email: DEMO_EMAIL, display_name: "Avery Chen", is_admin: false });

  // 2. demo spaces + access
  const spaceIdBySlug: Record<string, string> = {};
  for (const s of SPACES) {
    const { data, error } = await sb.from("spaces").upsert(s, { onConflict: "slug" }).select("id").single();
    if (error) throw error;
    spaceIdBySlug[s.slug] = data.id as string;
    await sb.from("space_access").upsert(
      { space_id: data.id, user_id: userId, role: "editor" },
      { onConflict: "space_id,user_id" },
    );
  }
  console.log("spaces ready:", Object.keys(spaceIdBySlug).join(", "));

  // 3. ingest (deferred import: pipeline pulls @/lib/env which needs dotenv first)
  const { ingestUpload } = await import("@/lib/ingest/pipeline");
  for (const d of DOCS) {
    const buffer = await readFile(path.join(CONTENT_DIR, d.file));
    const res = await ingestUpload(
      { filename: d.file, buffer, mimeType: "text/markdown" },
      { spaceId: spaceIdBySlug[d.space], uploaderId: userId, tags: d.tags, conflict: "replace", targetFolder: d.folder },
    );
    for (const r of res) console.log(`  ${d.space}/${r.path} → ${r.status} (${r.chunkCount ?? 0} chunks)`);
  }
  console.log("\nDEMO_EMAIL=" + DEMO_EMAIL + "\nDEMO_PASSWORD=" + DEMO_PASSWORD);
}
main().catch((e) => { console.error(e); process.exit(1); });
