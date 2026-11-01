import { useState, useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { Brand } from "./ui";
import { brand } from "../config/brand";
import { selfHosted } from "../lib/localBackend";
import { useEditorialMotion } from "../lib/useEditorialMotion";
import { useAos } from "../lib/useAos";
import "../styles/editorial.css";
import "../styles/motion.css";
import "../styles/immersive.css";
export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const site = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [userReduced, setUserReduced] = useState(() => {
    try {
      return localStorage.getItem("continuum-reduce-motion") === "true";
    } catch {
      return false;
    }
  });
  const [systemReduced, setSystemReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reduced = userReduced || systemReduced;
  useEditorialMotion(site, location.pathname, reduced);
  useAos(site, location.pathname, reduced);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [reduced]);
  useEffect(() => {
    setOpen(false);
    const frame = requestAnimationFrame(() => {
      if (location.hash) {
        let anchor = location.hash.slice(1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          /* malformed URL: keep literal fragment */
        }
        // A route change must finish positioning before scroll timelines measure it.
        // In-page chapter links retain native smooth scrolling.
        document
          .getElementById(anchor)
          ?.scrollIntoView({ behavior: "instant" });
      } else window.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [location]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return (
    <div
      className="public-site"
      ref={site}
      data-motion={reduced ? "reduced" : "full"}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <button
            ref={toggle}
            className="mobile-toggle icon-button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="public-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <nav
            id="public-navigation"
            className={open ? "public-nav open" : "public-nav"}
            aria-label="Main navigation"
          >
            <NavLink to="/product">Product</NavLink>
            <Link to="/#how-it-works">How it works</Link>
            <NavLink to="/integrations">Integrations</NavLink>
            <NavLink to="/developers">Developers</NavLink>
            <NavLink to="/pricing">Pricing</NavLink>
            <NavLink to="/docs">Docs</NavLink>
            <div className="nav-account">
              <Link
                className="button small"
                to={selfHosted ? "/app" : "/docs#setup"}
              >
                {selfHosted ? "Open workspace" : "Setup guide"}
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-signature" aria-hidden="true">
          Continuum<span>↗</span>
        </div>
        <div className="footer-top">
          <div>
            <Brand />
            <p>{brand.tagline}</p>
            <p className="small-text">Your context belongs with you.</p>
          </div>
          <div>
            <span className="eyebrow">Explore</span>
            <Link to="/product">Product</Link>
            <Link to="/integrations">Integrations</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div>
            <span className="eyebrow">Resources</span>
            <Link to="/docs">Documentation</Link>
            <Link to="/developers">Developers</Link>
            <Link to="/contact">Contact & support</Link>
          </div>
          <div>
            <span className="eyebrow">Your information</span>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/security">Security</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {brand.name}
          </span>
          <span>Built for continuity. Designed for control.</span>
          <button
            className="motion-toggle"
            disabled={systemReduced}
            aria-pressed={reduced}
            aria-label={
              systemReduced
                ? "Motion reduced by system"
                : userReduced
                  ? "Enable full motion"
                  : "Reduce motion"
            }
            onClick={() => {
              setUserReduced(!userReduced);
              try {
                localStorage.setItem(
                  "continuum-reduce-motion",
                  String(!userReduced),
                );
              } catch {
                /* Current-session preference still works. */
              }
            }}
          >
            <span aria-hidden="true">{reduced ? "Ⅱ" : "↗"}</span>{" "}
            {systemReduced
              ? "Motion: system reduced"
              : reduced
                ? "Motion: reduced"
                : "Motion: full"}
          </button>
        </div>
      </footer>
    </div>
  );
}
