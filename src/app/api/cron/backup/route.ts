import { NextResponse } from "next/server";

// Vercel Cron invokes this on the schedule in vercel.json.
// pg_dump can't run inside the Vercel Function runtime, so this endpoint just
// records the intent and delegates the actual dump to a host job — keep the
// real backup running via a separate scheduled environment (e.g. GitHub Actions
// or a long-running host) calling `npx tsx scripts/backup.ts`.
//
// If you wire up an external runner, set CRON_BACKUP_WEBHOOK and we'll POST to it.
export async function GET() {
  const webhook = process.env.CRON_BACKUP_WEBHOOK;
  if (webhook) {
    try {
      await fetch(webhook, { method: "POST" });
    } catch (err) {
      console.error("backup webhook failed", err);
    }
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
