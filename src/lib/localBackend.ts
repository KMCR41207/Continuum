import type { SupabaseClient } from "@supabase/supabase-js";

export const selfHosted = import.meta.env.VITE_BACKEND_MODE === "selfhosted";
export const localApiUrl =
  import.meta.env.VITE_MEMORY_API_URL || "http://127.0.0.1:8000";
type LocalSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string; user_metadata: Record<string, unknown> };
};
const listeners = new Set<
  (event: string, session: LocalSession | null) => void
>();
let session: LocalSession | null = null;
try {
  session = JSON.parse(
    sessionStorage.getItem("continuum-local-session") || "null",
  );
} catch {
  /* Storage unavailable. */
}
let refreshPromise: Promise<void> | null = null;
function setSession(value: LocalSession | null) {
  session = value;
  try {
    value
      ? sessionStorage.setItem("continuum-local-session", JSON.stringify(value))
      : sessionStorage.removeItem("continuum-local-session");
  } catch {
    /* Memory-only session still works. */
  }
  listeners.forEach((listener) =>
    listener(value ? "SIGNED_IN" : "SIGNED_OUT", value),
  );
}
export async function localRequest(
  path: string,
  body?: unknown,
  method?: string,
): Promise<any> {
  if (
    session &&
    session.expires_at < Date.now() / 1000 + 30 &&
    path !== "/api/v1/auth/refresh"
  ) {
    if (!refreshPromise)
      refreshPromise = (async () => {
        try {
          setSession(
            await localRequest("/api/v1/auth/refresh", {
              refresh_token: session!.refresh_token,
            }),
          );
        } catch {
          setSession(null);
        } finally {
          refreshPromise = null;
        }
      })();
    await refreshPromise;
  }
  const response = await fetch(localApiUrl + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : result.error || "Local service request failed",
    );
  return result;
}
async function result<T>(operation: () => Promise<T>) {
  try {
    return { data: await operation(), error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Local service unavailable. Start Continuum with pnpm selfhosted.",
      },
    };
  }
}
class LocalQuery {
  private filters: Record<string, unknown> = {};
  private action = "select";
  private values: unknown;
  private one = false;
  private optional = false;
  private count = false;
  private head = false;
  private ordering = "created_at";
  private ascending = false;
  private maximum = 1000;
  constructor(private table: string) {}
  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.count = Boolean(options?.count);
    this.head = Boolean(options?.head);
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }
  in(key: string, value: unknown[]) {
    this.filters[key] = value;
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.ordering = column;
    this.ascending = options?.ascending ?? true;
    return this;
  }
  limit(value: number) {
    this.maximum = value;
    return this;
  }
  insert(value: unknown) {
    this.action = "insert";
    this.values = value;
    return this;
  }
  upsert(value: unknown) {
    this.action = "upsert";
    this.values = value;
    return this;
  }
  update(value: unknown) {
    this.action = "update";
    this.values = value;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  maybeSingle() {
    this.one = true;
    this.optional = true;
    return this;
  }
  then(
    resolve: (value: any) => unknown,
    reject?: (reason: unknown) => unknown,
  ) {
    return this.execute().then(resolve, reject);
  }
  private async execute() {
    const response = await result(async () => {
      const path = `/api/v1/data/${this.table}`;
      const rows =
        this.action === "select"
          ? await localRequest(
              path +
                "?filters=" +
                encodeURIComponent(JSON.stringify(this.filters)),
            )
          : await localRequest(path, {
              action: this.action,
              values: this.values,
              filters: this.filters,
            });
      const list = Array.isArray(rows) ? rows : [rows];
      list.sort(
        (a, b) =>
          String(a[this.ordering] ?? "").localeCompare(
            String(b[this.ordering] ?? ""),
          ) * (this.ascending ? 1 : -1),
      );
      if (this.one && !list.length && !this.optional)
        throw new Error(
          "Record changed or is unavailable; refresh and try again",
        );
      return this.head
        ? null
        : this.one
          ? list[0] || null
          : list.slice(0, this.maximum);
    });
    return {
      ...response,
      count:
        this.count && Array.isArray(response.data)
          ? response.data.length
          : this.head
            ? ((
                await result(() =>
                  localRequest(
                    `/api/v1/data/${this.table}?filters=` +
                      encodeURIComponent(JSON.stringify(this.filters)),
                  ),
                )
              ).data?.length ?? 0)
            : null,
    };
  }
}

const auth = {
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () =>
    result(async () => ({ user: await localRequest("/api/v1/auth/user") })),
  onAuthStateChange(
    callback: (event: string, session: LocalSession | null) => void,
  ) {
    listeners.add(callback);
    return {
      data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
    };
  },
  signInWithPassword: async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) =>
    result(async () => {
      const value = await localRequest("/api/v1/auth/login", {
        email,
        password,
      });
      setSession(value);
      return { session: value, user: value.user };
    }),
  signUp: async ({ email, password, options }: any) =>
    result(async () => {
      const value = await localRequest("/api/v1/auth/setup", {
        email,
        password,
        name: options?.data?.full_name || "",
      });
      setSession(value);
      return { session: value, user: value.user };
    }),
  signOut: async (options?: { scope?: string }) =>
    result(async () => {
      await localRequest("/api/v1/auth/logout", {
        refresh_token: session?.refresh_token,
        global: options?.scope === "global",
      });
      setSession(null);
      return null;
    }),
  updateUser: async (changes: unknown) =>
    result(async () => {
      await localRequest("/api/v1/auth/user", changes, "PATCH");
      if (
        session &&
        typeof changes === "object" &&
        changes &&
        "data" in changes
      )
        setSession({
          ...session,
          user: {
            ...session.user,
            user_metadata: (changes as { data: Record<string, unknown> }).data,
          },
        });
      return { user: session?.user };
    }),
  resetPasswordForEmail: async () => ({
    error: {
      message:
        "Local password recovery uses the administrator CLI on this machine; no recovery email has been sent.",
    },
    data: null,
  }),
};
export const localBackend = {
  auth,
  from: (table: string) => new LocalQuery(table),
  rpc: (name: string, args: unknown) =>
    result(() => localRequest(`/api/v1/rpc/${name}`, args)),
} as unknown as SupabaseClient;
