import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll fails in Server Components — that's expected; middleware refreshes cookies.
        }
      },
    },
  });
}

// Service-role client. Bypasses RLS. Only call from trusted server contexts.
export function createServiceClient() {
  if (!env.supabaseSecretKey) {
    throw new Error(
      "Missing secret key: set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createServerClient(env.supabaseUrl, env.supabaseSecretKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
