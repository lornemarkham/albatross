import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { KITCHEN_NAV, LOCATIONS, showsNav } from "../lib/home/locations";

// ELK Home's frame around Kitchen: on a tablet or desktop (≥1024 px wide, an
// iPad in landscape) a big navigation rail stays on the left of every screen;
// on a phone each screen keeps its own "← Kitchen" link and the Today screen
// carries the shortcuts. Full-screen cooking hides the rail.

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function HomeShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const online = useOnline();
  const nav = showsNav(pathname);
  return (
    <>
      {!online && (
        <div role="status" className="sticky top-0 z-50 bg-saffron px-4 py-2 text-center text-base font-semibold text-cocoa lg:pl-32">
          Offline — showing what this screen last saw. Nothing can be changed until the internet is back.
        </div>
      )}
      {nav && (
        <nav aria-label="Kitchen" className="fixed inset-y-0 left-0 z-40 hidden w-28 flex-col items-stretch gap-1 border-r border-clay bg-cream/95 px-2 py-4 shadow-sm backdrop-blur lg:flex">
          <p className="mb-2 text-center font-display text-sm font-bold uppercase tracking-widest text-sage">ELK Home</p>
          {KITCHEN_NAV.map((n) => {
            const on = n.match(pathname);
            return (
              <Link key={n.to} to={n.to} aria-current={on ? "page" : undefined}
                className={`flex min-h-20 flex-col items-center justify-center rounded-2xl text-sm font-semibold transition ${on ? "bg-sage text-white shadow" : "text-bark hover:bg-clay/40"}`}>
                <span aria-hidden className="text-3xl leading-none">{n.icon}</span>
                <span className="mt-1">{n.label}</span>
              </Link>
            );
          })}
          <div className="mt-auto space-y-1 border-t border-clay pt-3 text-center text-xs text-bark/50">
            {LOCATIONS.filter((l) => !l.home).map((l) => (
              <p key={l.key} title={`${l.label}: not built yet`}><span aria-hidden>{l.icon}</span> {l.label} · soon</p>
            ))}
          </div>
        </nav>
      )}
      <div className={nav ? "lg:pl-28" : ""}>{children}</div>
    </>
  );
}
