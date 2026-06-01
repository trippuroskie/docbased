// Smoke test for the remote /mcp route (HTTP companion to smoke-mcp.mjs, which
// covers stdio). Two phases:
//   A. Admin — mint a PAT for an admin user; assert the unauthenticated request
//      is rejected, then drive initialize → tools/list → list_spaces → search.
//   B. Non-admin scoping — create an ephemeral auth user granted access to ONE
//      space, mint a PAT, and assert /mcp list_spaces returns ONLY that space.
// All temp resources (tokens, the ephemeral user) are cleaned up at the end.
//
//   node scripts/smoke-mcp-http.mjs            # against http://localhost:3000/mcp
//   MCP_E2E_URL=https://app.example.com/mcp node scripts/smoke-mcp-http.mjs
//
// Requires the dev server (or a deployment) running, and .env.local for the
// Supabase service key used to mint/revoke tokens and manage the temp user.

import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {}
}
await loadEnv(".env.local");
await loadEnv(".env");

const BASE = process.env.MCP_E2E_URL ?? "http://localhost:3000/mcp";
const PROTO = "2025-06-18";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

function ok(label, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
}

// A fresh MCP Streamable-HTTP client per token (own session id).
function createMcpClient(tokenValue) {
  let sessionId = null;
  async function send(method, params, { notification = false, auth = true } = {}) {
    const id = notification ? undefined : Math.floor(Math.random() * 1e6);
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTO,
    };
    if (auth && tokenValue) headers.authorization = `Bearer ${tokenValue}`;
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const resp = await fetch(BASE, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const sid = resp.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    const ct = resp.headers.get("content-type") ?? "";
    const text = await resp.text();
    if (notification) return { status: resp.status };
    let json = null;
    if (ct.includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5).trim());
          if (j.id === id || json === null) json = j;
        } catch {}
      }
    } else {
      try {
        json = JSON.parse(text);
      } catch {}
    }
    return { status: resp.status, json, raw: text };
  }
  return { send };
}

async function handshake(client) {
  const init = await client.send("initialize", {
    protocolVersion: PROTO,
    capabilities: {},
    clientInfo: { name: "e2e", version: "0" },
  });
  await client.send("notifications/initialized", {}, { notification: true });
  return init;
}

async function mintToken(userId, name) {
  const tok = "dbk_" + randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(tok).digest("hex");
  const { data, error } = await supabase
    .from("mcp_tokens")
    .insert({ user_id: userId, name, token_prefix: tok.slice(0, 10), token_hash: hash })
    .select("id")
    .single();
  if (error) throw new Error(`mint token failed: ${error.message}`);
  return { token: tok, id: data.id };
}

function callText(resp) {
  return resp.json?.result?.content?.[0]?.text ?? resp.raw;
}

function spaceSlugsFrom(text) {
  // list_spaces renders "- **Name** (slug: `slug`)"
  return [...String(text).matchAll(/slug:\s*`([^`]+)`/g)].map((m) => m[1]);
}

// Track temp resources for cleanup.
const tempTokenIds = [];
let tempUserId = null;

async function cleanup() {
  for (const id of tempTokenIds) {
    await supabase.from("mcp_tokens").delete().eq("id", id);
  }
  if (tempUserId) {
    // Deleting the auth user cascades public.users (on delete cascade), which
    // cascades space_access + mcp_tokens. Clear explicitly first to be safe.
    await supabase.from("mcp_tokens").delete().eq("user_id", tempUserId);
    await supabase.from("space_access").delete().eq("user_id", tempUserId);
    await supabase.auth.admin.deleteUser(tempUserId);
  }
  console.log("\ncleaned up temp token(s) + user.");
}

try {
  // ───────────────── Phase A: admin ─────────────────
  const { data: admin } = await supabase
    .from("users")
    .select("id, email")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  if (!admin) {
    console.error("No admin user in DB; cannot run admin phase.");
    process.exit(1);
  }
  const adminTok = await mintToken(admin.id, "_e2e admin (temp)");
  tempTokenIds.push(adminTok.id);
  console.log(`Phase A — admin ${admin.email} (token ${adminTok.token.slice(0, 10)}…)\n`);
  const adminClient = createMcpClient(adminTok.token);

  const noauth = await createMcpClient(null).send(
    "initialize",
    { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
    { auth: false },
  );
  ok("no token → 401", noauth.status === 401, `got ${noauth.status}`);

  const init = await handshake(adminClient);
  ok(
    "initialize",
    init.status === 200 && !!init.json?.result?.serverInfo,
    `server=${JSON.stringify(init.json?.result?.serverInfo ?? init.raw?.slice(0, 120))}`,
  );

  const tools = await adminClient.send("tools/list", {});
  const names = (tools.json?.result?.tools ?? []).map((t) => t.name);
  ok("tools/list", names.length >= 6, names.join(", "));

  const adminSpaces = await adminClient.send("tools/call", {
    name: "list_spaces",
    arguments: {},
  });
  const adminSlugs = spaceSlugsFrom(callText(adminSpaces));
  ok("admin list_spaces (sees all)", adminSlugs.length >= 1, adminSlugs.join(", "));

  const search = await adminClient.send("tools/call", {
    name: "search_documents",
    arguments: { query: "power bi", limit: 2 },
  });
  ok("search_documents", typeof callText(search) === "string" && callText(search).length > 0);

  // ───────────────── Phase B: non-admin scoping ─────────────────
  const { data: allSpaces, error: spErr } = await supabase
    .from("spaces")
    .select("id, slug, name")
    .order("name");
  if (spErr) throw new Error(`list spaces failed: ${spErr.message}`);
  if (!allSpaces || allSpaces.length < 2) {
    ok("non-admin scoping", false, "need ≥2 spaces to test scoping; skipping");
  } else {
    const granted = allSpaces[0];
    const withheld = allSpaces.slice(1);
    console.log(
      `\nPhase B — non-admin granted only '${granted.slug}', withheld: ${withheld.map((s) => s.slug).join(", ")}`,
    );

    // Create an ephemeral confirmed auth user (no email sent).
    const email = `mcp-scope-test-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
    const { data: created, error: cErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (cErr || !created?.user) throw new Error(`createUser failed: ${cErr?.message}`);
    tempUserId = created.user.id;

    const { error: uErr } = await supabase
      .from("users")
      .upsert({ id: tempUserId, email, is_admin: false });
    if (uErr) throw new Error(`users insert failed: ${uErr.message}`);

    const { error: aErr } = await supabase
      .from("space_access")
      .insert({ user_id: tempUserId, space_id: granted.id, role: "viewer" });
    if (aErr) throw new Error(`space_access insert failed: ${aErr.message}`);

    const naTok = await mintToken(tempUserId, "_e2e nonadmin (temp)");
    tempTokenIds.push(naTok.id);
    const naClient = createMcpClient(naTok.token);

    await handshake(naClient);
    const naResp = await naClient.send("tools/call", {
      name: "list_spaces",
      arguments: {},
    });
    const naText = callText(naResp);
    const naSlugs = spaceSlugsFrom(naText);

    ok(
      "non-admin sees exactly the granted space",
      naSlugs.length === 1 && naSlugs[0] === granted.slug,
      `saw [${naSlugs.join(", ")}], expected [${granted.slug}]`,
    );
    ok(
      "non-admin does NOT see withheld spaces",
      withheld.every((s) => !naSlugs.includes(s.slug)),
      `withheld=${withheld.map((s) => s.slug).join(", ")}`,
    );

    // Cross-check: a withheld space's docs must be unreachable via get_document.
    const withheldDoc = await supabase
      .from("documents")
      .select("id")
      .eq("space_id", withheld[0].id)
      .limit(1)
      .maybeSingle();
    if (withheldDoc.data?.id) {
      const getResp = await naClient.send("tools/call", {
        name: "get_document",
        arguments: { ref: withheldDoc.data.id },
      });
      const getText = String(callText(getResp));
      ok(
        "non-admin cannot fetch a withheld-space document",
        /not found|not accessible/i.test(getText),
        getText.slice(0, 80),
      );
    } else {
      console.log("  (no doc in withheld space to cross-check get_document; skipped)");
    }

    console.log("\n--- non-admin list_spaces ---\n" + String(naText).slice(0, 300));
  }
} catch (err) {
  console.error("smoke error:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
