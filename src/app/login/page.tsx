import { LoginForm } from "./login-form";
import { Suspense } from "react";

export const metadata = { title: "Sign in · docbased" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">docbased</h1>
          <p className="text-sm text-muted-foreground">
            Enter your work email — we&apos;ll send you a magic link.
          </p>
        </header>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
