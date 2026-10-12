/* PROJECT E.V. — site navigation (frontend-owned).
   Top bar on desktop (brand left, primary links, LOCAL
   and CLOUD status pills right), bottom bar on mobile.
   Carries the two separate link indicators: LOCAL
   (browser subsystem: IndexedDB ready) vs CLOUD
   (backend /api/chat reachability probe). Never
   conflates the two. */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  LayoutDashboard,
  MessagesSquare,
  Mic,
  Settings,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { useEv } from "@/lib/store";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistant", label: "Assistant", icon: MessagesSquare },
  { href: "/voice", label: "Voice", icon: Mic },
  { href: "/diagnostics", label: "Diagnostics", icon: Stethoscope },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/studio", label: "Studio", icon: Sparkles },
];

/** The two independent link indicators, as compact
 *  pills. LOCAL never borrows CLOUD's state and vice
 *  versa; the cloud pill doubles as the reachability
 *  probe (one indicator, one gesture). */
export function LinkStatus() {
  const {
    storageError,
    ready,
    backendReachable,
    backendConfigured,
    openRouterApiKey,
    recheckBackend,
  } = useEv();
  const localOk = ready && !storageError;
  const hasCustomKey = Boolean(openRouterApiKey?.trim());
  const hasKey = Boolean(hasCustomKey || backendConfigured);

  const cloudLabel =
    hasCustomKey
      ? backendReachable === false
        ? "Offline"
        : backendReachable === true
          ? "Online"
          : "Online (Key)"
      : backendReachable === null
        ? "Connecting…"
        : backendReachable
          ? hasKey
            ? "Online"
            : "Setup"
          : "Offline";

  const cloudTone =
    hasCustomKey
      ? backendReachable === false
        ? "bad"
        : backendReachable === true
          ? "ok"
          : "mute"
      : backendReachable === null
        ? "mute"
        : backendReachable
          ? hasKey
            ? "ok"
            : "warn"
          : "bad";

  return (
    <div className="ev-topbar-status">
      <span
        className="ev-status-pill"
        title="Local subsystem — browser IndexedDB"
      >
        <span
          className={`ev-dot ev-dot-${localOk ? "ok" : ready ? "warn" : "mute"}`}
        />
        LOCAL ·{" "}
        {ready ? (storageError ? "Degraded" : "IndexedDB") : "Mounting…"}
      </span>
      <button
        type="button"
        className="ev-status-pill"
        onClick={recheckBackend}
        title="Re-probe the backend /api/chat route"
      >
        <span className={`ev-dot ev-dot-${cloudTone}`} />
        CLOUD · {cloudLabel}
      </button>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const current = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <header className="ev-topbar">
        <Link href="/" className="ev-brand" aria-label="E.V. — home">
          <span className="ev-brand-mark">EV</span>
          <span className="ev-brand-text">
            <span className="ev-brand-name">E.V.</span>
            <span className="ev-brand-sub">Alfarez Console</span>
          </span>
        </Link>
        <nav className="ev-nav" aria-label="Primary">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={current(href) ? "page" : undefined}
            >
              <Icon /> {label}
            </Link>
          ))}
        </nav>
        <div className="ev-topbar-actions">
          <LinkStatus />
          <Link
            href="/settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
            className="ev-icon-btn"
            aria-label="Settings"
            title="Settings"
          >
            <Settings style={{ width: 15, height: 15 }} />
          </Link>
        </div>
      </header>
      <nav className="ev-bottomnav" aria-label="Primary">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={current(href) ? "page" : undefined}
          >
            <Icon /> {label}
          </Link>
        ))}
        <Link
          href="/settings"
          aria-current={pathname === "/settings" ? "page" : undefined}
          aria-label="Settings"
        >
          <Settings /> Settings
        </Link>
      </nav>
    </>
   );
}
