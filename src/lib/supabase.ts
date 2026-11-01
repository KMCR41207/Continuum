import { createClient } from "@supabase/supabase-js";
import { selfHosted, localBackend } from "./localBackend";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = selfHosted || Boolean(url && key);
export const supabase = selfHosted
  ? localBackend
  : configured
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      })
    : null;
export function db() {
  if (!supabase)
    throw new Error("Supabase is not configured. Follow the setup guide.");
  return supabase;
}
