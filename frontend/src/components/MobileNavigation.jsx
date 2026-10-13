import { useEffect, useId, useRef, useState } from "react";
import { NAVIGATION_ITEMS, isNavigationItemActive } from "../utils/navigation.js";

const QUICK_VIEWS = ["dashboard", "records", "aiInsights"];
const QUICK_ITEMS = QUICK_VIEWS.map((view) => NAVIGATION_ITEMS.find((item) => item.view === view));
const ALL_ITEMS = [...NAVIGATION_ITEMS, { view: "settings", label: "Settings", icon: "settings" }];

const ICON_PATHS = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  category: "M12 3 7 11h10zM3 15h7v7H3zM21 18a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
  menu_book: "M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15",
  groups: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  assignment: "M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12h8M8 16h6",
  table_view: "M3 4h18v16H3zM3 10h18M3 15h18M9 10v10M15 10v10",
  intervention: "M4 20h16M6 16V9m6 7V4m6 12v-5",
  archive: "M3 3h18v5H3zM5 8v12h14V8M10 12h4",
  workspace_premium: "M17 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0M8 12l-2 9 6-3 6 3-2-9",
  auto_awesome: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4",
  settings: "m9.5 3-.5 2-2 1-2-.5-2 3.5L4.5 11v2L3 15l2 3.5 2-.5 2 1 .5 2h5l.5-2 2-1 2 .5 2-3.5-1.5-2v-2L21 9l-2-3.5-2 .5-2-1-.5-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  logout: "M9 3H4v18h5M10 12h11m-4-4 4 4-4 4",
  all: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z",
  close: "m6 6 12 12M6 18 18 6",
};

function NavigationIcon({ icon }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[icon]} /></svg>;
}

export default function MobileNavigation({ activeView, onNavigate, onLogout }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!expanded) return;
    const media = window.matchMedia("(max-width: 767px)");
    const dismiss = (event) => {
      if (!rootRef.current?.contains(event.target)) setExpanded(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        toggleRef.current?.focus();
      }
    };
    const handleResize = (event) => { if (!event.matches) setExpanded(false); };
    (listRef.current?.querySelector('[aria-current="page"]') ?? listRef.current?.querySelector("button"))?.focus();
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleKey);
    media.addEventListener("change", handleResize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleKey);
      media.removeEventListener("change", handleResize);
    };
  }, [expanded]);

  const chooseView = (view) => {
    setExpanded(false);
    if (expanded) toggleRef.current?.focus();
    onNavigate(view);
  };

  return (
    <div ref={rootRef} className="edulite-mobile-navigation" onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
    }}>
      {expanded && (
        <section id={listId} className="edulite-mobile-menu" aria-label="All pages">
          <div className="edulite-mobile-menu-heading">
            <h2>All pages</h2>
            <button type="button" aria-label="Close navigation list" onClick={() => {
              setExpanded(false);
              toggleRef.current?.focus();
            }}><NavigationIcon icon="close" /></button>
          </div>
          <nav ref={listRef} aria-label="All navigation">
            {ALL_ITEMS.map((item) => (
              <button key={item.view} type="button" aria-current={isNavigationItemActive(item, activeView) ? "page" : undefined} onClick={() => chooseView(item.view)}>
                <NavigationIcon icon={item.icon} /><span>{item.label}</span>
              </button>
            ))}
            <button type="button" className="edulite-mobile-logout" onClick={() => { setExpanded(false); onLogout(); }}>
              <NavigationIcon icon="logout" /><span>Logout</span>
            </button>
          </nav>
        </section>
      )}
      <nav className="edulite-mobile-quick-links" aria-label="Quick navigation">
        {QUICK_ITEMS.map((item) => (
          <button key={item.view} type="button" aria-label={item.label} title={item.label} aria-current={activeView === item.view ? "page" : undefined} onClick={() => chooseView(item.view)}>
            <NavigationIcon icon={item.icon} />
          </button>
        ))}
      </nav>
      <button ref={toggleRef} type="button" className="edulite-mobile-view-all" data-active={!QUICK_VIEWS.includes(activeView) || expanded} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((current) => !current)}>
        <NavigationIcon icon={expanded ? "close" : "all"} /><span>View all</span>
      </button>
    </div>
  );
}
