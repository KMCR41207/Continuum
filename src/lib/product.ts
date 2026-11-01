import { useCallback, useEffect, useState, useRef } from "react";
import { db } from "./supabase";
import { errorMessage } from "./api";
import { selfHosted, localRequest } from "./localBackend";
export function useRpc<T>(name: string, args: Record<string, unknown>) {
  const key = JSON.stringify(args);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const r = await db().rpc(name, JSON.parse(key));
      if (request !== revision.current) return;
      if (r.error) throw r.error;
      setData(r.data);
    } catch (e) {
      if (request === revision.current) {
        setError(errorMessage(e));
        setData(null);
      }
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [name, key]);
  useEffect(() => {
    void reload();
    return () => {
      revision.current++;
    };
  }, [reload]);
  return { data, error, loading, reload };
}
export async function productApi(path: string, body?: unknown) {
  if (selfHosted) return localRequest(path, body);
  const base = import.meta.env.VITE_API_URL;
  if (!base)
    throw new Error("Application server is not configured. Set VITE_API_URL.");
  const { data } = await db().auth.getSession();
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(data.session
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Server request failed");
  return result;
}
export type Usage = {
  plan: string;
  billing_status: string;
  limits: Record<string, number>;
  memories: number;
  pending: number;
  conversations: number;
  projects: number;
  connections: number;
  verified_agents: number;
  requests_30d: number;
  jobs: number;
  stored_text_bytes: number;
  last_successful_sync: string | null;
};
