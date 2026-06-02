"use client";

import * as React from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { McpTokenRow } from "@/lib/core/tokens";
import { createTokenAction, revokeTokenAction } from "./token-actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AccessTokens({
  initial,
  mcpUrl,
}: {
  initial: McpTokenRow[];
  mcpUrl: string;
}) {
  const [tokens, setTokens] = React.useState<McpTokenRow[]>(initial);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [freshToken, setFreshToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);
  const [copiedConfig, setCopiedConfig] = React.useState(false);

  const active = tokens.filter((t) => !t.revokedAt);

  // Claude Desktop bridges remote servers through mcp-remote; the token goes in
  // `env` so it stays out of the args list. (Claude Code speaks HTTP transport
  // natively: `claude mcp add --transport http docbased <url> --header ...`.)
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        docbased: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote@latest",
            mcpUrl,
            "--header",
            "Authorization:${DOCBASED_AUTH_HEADER}",
          ],
          env: { DOCBASED_AUTH_HEADER: "Bearer dbk_your_token_here" },
        },
      },
    },
    null,
    2,
  );

  const copyUrl = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopiedUrl(true);
    toast.success("MCP URL copied");
  };

  const copyConfig = async () => {
    await navigator.clipboard.writeText(desktopConfig);
    setCopiedConfig(true);
    toast.success("Config copied");
  };

  const create = async () => {
    setCreating(true);
    try {
      const { token, row } = await createTokenAction(name);
      setTokens((prev) => [row, ...prev]);
      setFreshToken(token);
      setName("");
      setCopied(false);
    } catch (err) {
      toast.error(`Could not create token: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await revokeTokenAction(id);
      setTokens((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t,
        ),
      );
      toast.success("Token revoked");
    } catch (err) {
      toast.error(`Could not revoke token: ${(err as Error).message}`);
    } finally {
      setRevoking(null);
    }
  };

  const copyFresh = async () => {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
    toast.success("Token copied to clipboard");
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-5">
      <header>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="size-4" /> Access tokens
        </h2>
        <p className="text-xs text-muted-foreground">
          Personal tokens for the docbased CLI and remote MCP server. A token
          carries <strong>your</strong> space access. Treat it like a password —
          it&apos;s shown once and can&apos;t be recovered, only revoked.
        </p>
      </header>

      {/* Remote MCP endpoint — the canonical URL + a copy-paste Claude Desktop
          config. Use this exact host: the apex redirects, and a redirect drops
          the Authorization header, which breaks the MCP connection. */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <Label className="text-xs font-medium">Remote MCP endpoint</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-xs font-mono">
            {mcpUrl}
          </code>
          <Button size="sm" variant="secondary" onClick={copyUrl}>
            {copiedUrl ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            Claude Desktop config
          </summary>
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Add to <code className="font-mono">claude_desktop_config.json</code>, replace the
              token, then fully restart Claude Desktop. In Claude Code instead run{" "}
              <code className="font-mono">claude mcp add --transport http docbased {mcpUrl}</code>.
            </p>
            <div className="relative">
              <pre className="overflow-x-auto rounded bg-background p-2 text-[10px] font-mono leading-relaxed">
                {desktopConfig}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="absolute right-1.5 top-1.5"
                onClick={copyConfig}
              >
                {copiedConfig ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>
        </details>
      </div>

      {/* One-time reveal of a freshly-created token */}
      {freshToken && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-[11px] font-medium text-primary">
            Copy your new token now — you won&apos;t see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-xs font-mono">
              {freshToken}
            </code>
            <Button size="sm" variant="secondary" onClick={copyFresh}>
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setFreshToken(null)}
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      {/* Create */}
      <div className="space-y-1.5">
        <Label htmlFor="token-name" className="text-xs font-medium">
          New token
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Desktop — laptop"
            className="h-8 text-xs max-w-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creating) create();
            }}
          />
          <Button size="sm" onClick={create} disabled={creating}>
            {creating ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <Plus className="size-3.5 mr-1.5" />
            )}
            Generate
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active tokens.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {active.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">
                      {t.name}
                    </span>
                    <code className="text-[10px] text-muted-foreground font-mono">
                      {t.tokenPrefix}…
                    </code>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    created {fmtDate(t.createdAt)} · last used{" "}
                    {fmtDate(t.lastUsedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => revoke(t.id)}
                  disabled={revoking === t.id}
                >
                  {revoking === t.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
