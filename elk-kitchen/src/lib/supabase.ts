import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The ELK Supabase project (shared with ELK Inventory). Without these, ELK
// Kitchen runs on this device only, as it always has.
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function assertBrowserKey(key: string): void {
  if (key.startsWith("sb_secret_")) {
    throw new Error("VITE_SUPABASE_ANON_KEY is a secret key (sb_secret_…). Use the publishable key.");
  }
  try {
    if (JSON.parse(atob(key.split(".")[1] ?? "")).role === "service_role") {
      throw new Error("VITE_SUPABASE_ANON_KEY is the service_role key. Use the anon / publishable key.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("service_role")) throw e;
  }
}

if (supabaseAnonKey) assertBrowserKey(supabaseAnonKey);

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
