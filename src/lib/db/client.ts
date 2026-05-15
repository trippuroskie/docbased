import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local.");
}

// Use the service-role connection only in server code; RLS does not apply.
// Most app reads should go through the Supabase JS client to inherit RLS.
const client = postgres(url, { prepare: false, max: 10 });
export const db = drizzle(client, { schema });
export { schema };
