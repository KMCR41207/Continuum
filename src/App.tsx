import { lazy, Suspense } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { PublicLayout } from "./components/PublicLayout";
import { AppLayout } from "./components/AppLayout";
import { Home } from "./pages/Home";
import { selfHosted } from "./lib/localBackend";

// Route-level code splitting — keeps the initial bundle lean.
// Each lazy chunk is only downloaded when the user navigates to that route.
const Product      = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Product })));
const Integrations = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Integrations })));
const Pricing      = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Pricing })));
const Developers   = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Developers })));
const Docs         = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Docs })));
const PolicyPage   = lazy(() => import("./pages/PublicPages").then((m) => ({ default: m.Policy })));

const AuthPage     = lazy(() => import("./pages/Auth").then((m) => ({ default: m.AuthPage })));
const LocalAccess  = lazy(() => import("./pages/LocalAccess").then((m) => ({ default: m.LocalAccess })));
const InvitePage   = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.InvitePage })));

const Overview     = lazy(() => import("./pages/app/Overview").then((m) => ({ default: m.Overview })));
const Memories     = lazy(() => import("./pages/app/Memories").then((m) => ({ default: m.Memories })));
const Conversations = lazy(() => import("./pages/app/Conversations").then((m) => ({ default: m.Conversations })));
const Projects     = lazy(() => import("./pages/app/Projects").then((m) => ({ default: m.Projects })));
const LocalFiles   = lazy(() => import("./pages/app/LocalFiles").then((m) => ({ default: m.LocalFiles })));
const Connections  = lazy(() => import("./pages/app/Connections").then((m) => ({ default: m.Connections })));
const ActivityPage = lazy(() => import("./pages/app/OtherPages").then((m) => ({ default: m.ActivityPage })));
const SettingsPage = lazy(() => import("./pages/app/OtherPages").then((m) => ({ default: m.SettingsPage })));
const OnboardingPage = lazy(() => import("./pages/app/Onboarding").then((m) => ({ default: m.OnboardingPage })));
const UsagePage    = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.UsagePage })));
const BillingPage  = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.BillingPage })));
const TeamPage     = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.TeamPage })));
const JobsPage     = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.JobsPage })));
const SecurityPage = lazy(() => import("./pages/app/ProductPages").then((m) => ({ default: m.SecurityPage })));

// Minimal fallback shown while a lazy chunk is downloading (no layout shift).
function PageFallback() {
  return <div style={{ minHeight: "60vh" }} aria-hidden="true" />;
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="product" element={<Product />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="developers" element={<Developers />} />
          <Route path="docs" element={<Docs />} />
          {(["privacy", "terms", "security", "contact"] as const).map((type) => (
            <Route path={type} key={type} element={<PolicyPage type={type} />} />
          ))}
        </Route>
        <Route
          path="signin"
          element={selfHosted ? <LocalAccess /> : <AuthPage mode="signin" />}
        />
        <Route
          path="signup"
          element={selfHosted ? <LocalAccess /> : <AuthPage mode="signup" />}
        />
        <Route path="reset-password" element={<AuthPage mode="reset" />} />
        <Route path="auth/password" element={<AuthPage mode="password" />} />
        <Route path="invite" element={<InvitePage />} />
        <Route path="app" element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="memories" element={<Memories />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="projects" element={<Projects />} />
          {selfHosted && <Route path="files" element={<LocalFiles />} />}
          <Route path="connections" element={<Connections />} />
          <Route path="agents" element={<Connections />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="security" element={<SecurityPage />} />
        </Route>
        <Route
          path="*"
          element={
            <div className="content inner-page">
              <h1>This page isn't here.</h1>
              <Link className="button" to="/">
                Return home
              </Link>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
