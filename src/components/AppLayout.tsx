import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Layers,
  MessagesSquare,
  FolderKanban,
  Plug,
  Bot,
  Activity,
  Settings,
  Menu,
  X,
  LogOut,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { Brand, Notice, ActionLink } from "./ui";
import { useAuth } from "../lib/AuthContext";
import { configured, db } from "../lib/supabase";
import { selfHosted } from "../lib/localBackend";
import { errorMessage } from "../lib/api";
import type { Workspace } from "../lib/types";
const WorkspaceContext = createContext<{
  workspace: Workspace;
  reload: () => Promise<void>;
}>({ workspace: null as unknown as Workspace, reload: async () => {} });
export const useWorkspace = () => useContext(WorkspaceContext);
export function AppLayout() {
  const { session, loading, error: authError } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState("");
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const reload = useCallback(async () => {
    if (!session) return;
    setError("");
    try {
      const { data, error } = await db()
        .from("workspaces")
        .select("*")
        .order("created_at");
      if (error) throw error;
      setWorkspaces(data);
      setCurrent((c) => (data.some((w) => w.id === c) ? c : data[0]?.id || ""));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFetching(false);
    }
  }, [session]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!configured)
    return (
      <div className="configuration-page">
        <Brand />
        <div>
          <span className="eyebrow">WORKSPACE / CONFIGURATION REQUIRED</span>
          <h1>
            Your memory needs
            <br />
            <em>a secure home.</em>
          </h1>
          <p>
            Connect Supabase to enable real accounts, persistent conversations,
            and your private workspace. This build does not use a simulated
            account.
          </p>
          <div className="config-keys">
            <code>VITE_SUPABASE_URL</code>
            <code>VITE_SUPABASE_ANON_KEY</code>
            <span>Then apply the database migration and restart the site.</span>
          </div>
          <ActionLink to="/docs">Open setup instructions</ActionLink>
          <ActionLink to="/" secondary>
            Return to website
          </ActionLink>
        </div>
      </div>
    );
  if (loading)
    return (
      <div className="loading-page" role="status">
        Restoring your session…
      </div>
    );
  if (authError) return <Notice error>{authError}</Notice>;
  if (!session) return <Navigate to="/signin" replace />;
  if (fetching)
    return (
      <div className="loading-page" role="status">
        Loading your workspace…
      </div>
    );
  if (error)
    return (
      <div className="content inner-page">
        <Notice error>{error}</Notice>
        <button className="button" onClick={reload}>
          Retry loading workspace
        </button>
        <ActionLink to="/docs" secondary>
          Setup guide
        </ActionLink>
      </div>
    );
  const workspace = workspaces.find((w) => w.id === current);
  if (!workspace) return <Onboarding reload={reload} />;
  const nav = [
    ["", "Overview", LayoutDashboard],
    ["memories", "Memories", Layers],
    ["conversations", "Conversations", MessagesSquare],
    ["projects", "Projects", FolderKanban],
    ["connections", "Connections", Plug],
    ["agents", "Agents", Bot],
    ["activity", "Activity", Activity],
    ["usage", "Usage", Layers],
    ["billing", "Billing", Layers],
    ["team", "Team", Bot],
    ["jobs", "Processing jobs", Activity],
    ["security", "Security and data", Settings],
    ["settings", "Settings", Settings],
  ] as const;
  async function signOut() {
    const { error } = await db().auth.signOut();
    if (error) setError(error.message);
    else navigate("/signin");
  }
  return (
    <WorkspaceContext.Provider value={{ workspace, reload }}>
      <div className="app-layout">
        <a className="skip-link" href="#app-main">
          Skip to content
        </a>
        <header className="app-mobile-header">
          <Brand />
          <button
            className="icon-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </header>
        <aside className={`app-sidebar ${open ? "open" : ""}`}>
          <Brand />
          <div className="workspace-label">YOUR WORKSPACE</div>
          <nav aria-label="Workspace navigation">
            {nav.map(([path, label, Icon]) => (
              <NavLink
                key={path}
                to={"/app" + (path ? "/" + path : "")}
                end={path === ""}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>
          {selfHosted && (
            <NavLink to="/app/files" onClick={() => setOpen(false)}>
              Project files
            </NavLink>
          )}
          <div className="sidebar-bottom">
            <NavLink to="/docs">
              <BookOpen size={16} />
              Documentation
              <ArrowUpRight size={14} />
            </NavLink>
            <label>
              Workspace
              <select
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="user-row">
              <span className="avatar">
                {session.user.email?.[0].toUpperCase()}
              </span>
              <div>
                <strong>
                  {session.user.user_metadata.full_name || "Your account"}
                </strong>
                <small>Continuum workspace</small>
              </div>
              <button
                onClick={signOut}
                className="icon-button"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>
        <main id="app-main" className="app-main">
          <div className="app-topline">
            <span>{workspace.name}</span>
            <span>
              <span className="status-dot" /> Private workspace
            </span>
          </div>
          <Outlet key={workspace.id} />
        </main>
      </div>
    </WorkspaceContext.Provider>
  );
}
function Onboarding({ reload }: { reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="onboarding">
      <Brand />
      <div className="onboarding-panel">
        <span className="eyebrow">01 / YOUR FIRST WORKSPACE</span>
        <h1>
          A home for
          <br />
          <em>your context.</em>
        </h1>
        <p>
          Start with a private workspace. Next, you can create a project or
          import a conversation. All proposed memories start in review.
        </p>
        {error && <Notice error>{error}</Notice>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const name = String(new FormData(e.currentTarget).get("name"));
            try {
              const { error } = await db().rpc("create_workspace", {
                p_name: name,
              });
              if (error) throw error;
              await reload();
              navigate("/app/onboarding");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Workspace name
            <input
              name="name"
              required
              maxLength={100}
              placeholder="My workspace"
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
            <ArrowUpRight size={16} />
          </button>
        </form>
        <p className="small-text">
          Integrations are optional. You can configure your preferences in
          Settings.
        </p>
      </div>
    </div>
  );
}
