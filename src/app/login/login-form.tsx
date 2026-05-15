"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = createClient();

    if (password) {
      // Password sign-in — bypasses email entirely.
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setStatus("error");
        return;
      }
      router.push(next);
      router.refresh();
      return;
    }

    // Magic link fallback.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm">
        <p className="font-medium">Check your inbox.</p>
        <p className="mt-2 text-muted-foreground">
          We sent a magic link to <strong>{email}</strong>. Click it to sign in.
          If you don&apos;t see it within a minute, check spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">
          Password{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (optional — leave blank for magic link)
          </span>
        </Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={status === "sending"}>
        {status === "sending"
          ? password
            ? "Signing in…"
            : "Sending…"
          : password
            ? "Sign in"
            : "Send magic link"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Invite-only. Don&apos;t have access? Ask an admin to invite you.
      </p>
    </form>
  );
}
