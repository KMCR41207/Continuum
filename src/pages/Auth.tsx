import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Brand, Notice, TextLink } from "../components/ui";
import { configured, db } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { errorMessage } from "../lib/api";
export function AuthPage({
  mode,
}: {
  mode: "signin" | "signup" | "reset" | "password";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { session } = useAuth();
  const navigate = useNavigate();
  if (session && ["signin", "signup"].includes(mode))
    return <Navigate to="/app" replace />;
  const title = {
    signin: "Pick up where\nyou left off.",
    signup: "A little context.\nA new beginning.",
    reset: "Let’s get you\nback in.",
    password: "A fresh start\nfor your password.",
  }[mode];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    try {
      if (mode === "signup") {
        const { error } = await db().auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/app",
            data: { full_name: form.get("name") },
          },
        });
        if (error) throw error;
        setNotice("Check your email for a confirmation link, then sign in.");
      } else if (mode === "signin") {
        const { error } = await db().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate("/app");
      } else if (mode === "reset") {
        const { error } = await db().auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth/password",
        });
        if (error) throw error;
        setNotice(
          "If an account exists for this email, a password reset link will arrive shortly.",
        );
      } else {
        const { error } = await db().auth.updateUser({ password });
        if (error) throw error;
        setNotice("Your password has been updated.");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setBusy(true);
    setError("");
    try {
      const { error } = await db().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/app" },
      });
      if (error) throw error;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-editorial">
        <Brand />
        <div>
          <span className="eyebrow">ONE MEMORY. EVERY INTELLIGENCE.</span>
          <h2>
            Your next idea
            <br />
            doesn’t need
            <br />
            <em>a blank slate.</em>
          </h2>
          <p>
            The decisions, preferences, and context that make your work yours.
            Ready for what comes next.
          </p>
        </div>
        <span className="small-text">
          <LockKeyhole size={14} /> Your memory stays under your control.
        </span>
      </div>
      <div className="auth-form-area">
        <Link className="back-link" to="/">
          ← Back to website
        </Link>
        <div className="auth-form">
          <h1>
            {title.split("\n").map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h1>
          <p>
            {mode === "signup"
              ? "Create your account to start a private memory workspace."
              : mode === "signin"
                ? "Sign in to your memory workspace."
                : "Use your account email to recover access."}
          </p>
          {!configured && (
            <Notice>
              Account services need setup. Add the Supabase project URL and
              public key to enable secure sign-in.{" "}
              <Link to="/docs">Setup instructions →</Link>
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  placeholder="Your name"
                />
              </label>
            )}
            {mode !== "password" && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "signin" ? 1 : 12}
                  maxLength={128}
                  placeholder={
                    mode === "signin"
                      ? "Your password"
                      : "At least 12 characters"
                  }
                />
              </label>
            )}
            {mode === "signin" && (
              <Link className="form-link" to="/reset-password">
                Forgot password?
              </Link>
            )}
            <button className="button full" disabled={busy || !configured}>
              {busy
                ? "Please wait…"
                : {
                    signin: "Sign in",
                    signup: "Create account",
                    reset: "Send reset link",
                    password: "Update password",
                  }[mode]}
              <ArrowRight size={16} />
            </button>
          </form>
          {configured &&
            import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true" &&
            ["signin", "signup"].includes(mode) && (
              <button
                className="button secondary full"
                onClick={google}
                disabled={busy}
              >
                Continue with Google
              </button>
            )}
          <p className="auth-switch">
            {mode === "signin" ? (
              <>
                New here? <Link to="/signup">Create an account</Link>
              </>
            ) : (
              <>
                Already have an account? <Link to="/signin">Sign in</Link>
              </>
            )}
          </p>
          <p className="small-text">
            By continuing, you acknowledge the <Link to="/terms">terms</Link>{" "}
            and <Link to="/privacy">data disclosure</Link>.
          </p>
          {mode === "password" && notice && (
            <TextLink to="/app">Open your workspace</TextLink>
          )}
        </div>
      </div>
    </div>
  );
}
