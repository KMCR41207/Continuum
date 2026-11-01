import { Routes, Route, Link } from "react-router-dom";
import { PublicLayout } from "./components/PublicLayout";
import { AppLayout } from "./components/AppLayout";
import { Home } from "./pages/Home";
import {
  Product,
  Integrations,
  Pricing,
  Developers,
  Docs,
  Policy,
} from "./pages/PublicPages";
import { AuthPage } from "./pages/Auth";
import { LocalAccess } from "./pages/LocalAccess";
import { LocalFiles } from "./pages/app/LocalFiles";
import { selfHosted } from "./lib/localBackend";
import { Overview } from "./pages/app/Overview";
import { Memories } from "./pages/app/Memories";
import { Conversations } from "./pages/app/Conversations";
import { Projects } from "./pages/app/Projects";
import { ActivityPage, SettingsPage } from "./pages/app/OtherPages";
import { Connections } from "./pages/app/Connections";
import {
  UsagePage,
  BillingPage,
  TeamPage,
  JobsPage,
  SecurityPage,
  InvitePage,
} from "./pages/app/ProductPages";
import { OnboardingPage } from "./pages/app/Onboarding";
export function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="product" element={<Product />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="developers" element={<Developers />} />
        <Route path="docs" element={<Docs />} />
        {(["privacy", "terms", "security", "contact"] as const).map((type) => (
          <Route path={type} key={type} element={<Policy type={type} />} />
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
            <h1>This page isn’t here.</h1>
            <Link className="button" to="/">
              Return home
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
