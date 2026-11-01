import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/AuthContext";
import { brand } from "./config/brand";
import "./styles/tokens.css";
import "./styles/site.css";
document.title = brand.metadata.title;
document.documentElement.style.setProperty(
  "--color-accent",
  brand.primaryColor,
);
for (const [name, content] of [
  ["description", brand.metadata.description],
  ["og:title", brand.social.title],
  ["og:description", brand.social.description],
]) {
  const meta =
    document.querySelector<HTMLMetaElement>(
      `meta[${name.startsWith("og:") ? "property" : "name"}="${name}"]`,
    ) || document.createElement("meta");
  meta.setAttribute(name.startsWith("og:") ? "property" : "name", name);
  meta.content = content;
  document.head.append(meta);
}
const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.href = brand.favicon;
document.head.append(favicon);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
