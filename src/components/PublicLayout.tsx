import { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { Brand } from "./ui";
import { brand } from "../config/brand";
export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    if (!location.hash) window.scrollTo(0, 0);
  }, [location]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <button
            className="mobile-toggle icon-button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <nav
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
              <Link to="/signin">Sign in</Link>
              <Link className="button small" to="/signup">
                Get started
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
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
        </div>
      </footer>
    </>
  );
}
