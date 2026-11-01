import { createClient } from "@supabase/supabase-js";
export function serviceClient(env: NodeJS.ProcessEnv = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Server Supabase configuration required");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function memberClient(
  jwt: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new Error("Server Supabase configuration required");
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
