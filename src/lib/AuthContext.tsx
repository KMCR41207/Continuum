import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
const Context = createContext<{
  session: Session | null;
  loading: boolean;
  error: string;
}>({ session: null, loading: true, error: "" });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session);
          setLoading(false);
          if (error) setError(error.message);
        }
      })
      .catch(() => {
        if (active) {
          setError("Unable to restore your session.");
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return (
    <Context.Provider value={{ session, loading, error }}>
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
