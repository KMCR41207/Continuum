import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Brand, Notice } from "../components/ui";
import { useAuth } from "../lib/AuthContext";
import { localRequest } from "../lib/localBackend";
import { db } from "../lib/supabase";
export function LocalAccess() {
  const { session } = useAuth();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    localRequest("/api/v1/auth/status")
      .then((status) => setSetup(status.setup_required))
      .catch(() =>
        setError(
          "The local memory service is unavailable. Start it with pnpm selfhosted.",
        ),
      );
  }, []);
  if (session) return <Navigate to="/app" replace />;
  return (
    <div className="configuration-page">
      <Brand />
      <div>
        <span className="eyebrow">CONTINUUM / SELF-HOSTED WORKSPACE</span>
        <h1>
          {setup ? "Create your local workspace." : "Open your workspace."}
        </h1>
        <p>
          {setup
            ? "Choose an administrator password for this installation. Your data stays on this machine. No Supabase account or email confirmation is required."
            : "Use the administrator account created on this installation."}
        </p>
        {error && <Notice error>{error}</Notice>}
        {setup !== null && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(event.currentTarget);
              const credentials = {
                email: String(data.get("email")),
                password: String(data.get("password")),
              };
              const response = setup
                ? await db().auth.signUp(credentials)
                : await db().auth.signInWithPassword(credentials);
              if (response.error) setError(response.error.message);
              setBusy(false);
            }}
          >
            <label>
              Email for your local account
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy
                ? "Opening…"
                : setup
                  ? "Create local workspace"
                  : "Open workspace"}
            </button>
          </form>
        )}
        <Link to="/">Back to website</Link>
      </div>
    </div>
  );
}
