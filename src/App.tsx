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
import { Overview } from "./pages/app/Overview";
import { Memories } from "./pages/app/Memories";
import { Conversations } from "./pages/app/Conversations";
import { Projects } from "./pages/app/Projects";
import { ActivityPage, SettingsPage } from "./pages/app/OtherPages";
import { Connections } from "./pages/app/Connections";
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
      <Route path="signin" element={<AuthPage mode="signin" />} />
      <Route path="signup" element={<AuthPage mode="signup" />} />
      <Route path="reset-password" element={<AuthPage mode="reset" />} />
      <Route path="auth/password" element={<AuthPage mode="password" />} />
      <Route path="app" element={<AppLayout />}>
        <Route index element={<Overview />} />
        <Route path="memories" element={<Memories />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="projects" element={<Projects />} />
        <Route path="connections" element={<Connections />} />
        <Route path="agents" element={<Connections />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
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
