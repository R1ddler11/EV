/* PROJECT E.V. — shell navigation (frontend-owned).
   Sidebar on desktop, bottom bar on mobile. Carries the two separate link
   indicators: LOCAL (browser subsystem: IndexedDB ready) vs CLOUD (backend
   /api/chat reachability probe). Never conflates the two. */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  LayoutDashboard,
  MessagesSquare,
  Mic,
  RefreshCw,
  Settings,
  Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useEv } from "@/lib/store";
import SettingsModal from "./settings-modal";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistant", label: "Assistant", icon: MessagesSquare },
  { href: "/voice", label: "Voice", icon: Mic },
  { href: "/diagnostics", label: "Diagnostics", icon: Stethoscope },
  { href: "/memory", label: "Memory", icon: Brain },
];

function useClock(): string {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const tick = () => {
      const d = new Date();
      setNow(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function LinkStatus() {
  const {
    storageError,
    ready,
    backendReachable,
    backendConfigured,
    openRouterApiKey,
    openRouterModel,
    recheckBackend,
    openSettings,
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
        : "ok"
      : backendReachable === null
        ? "mute"
        : backendReachable
          ? hasKey
            ? "ok"
            : "warn"
          : "bad";
  return (
    <div className="ev-stack" style={{ gap: 8 }}>
      <div className="ev-link-row">
        <span>Subsystem · Local</span>
        <span
          className={`ev-dot ev-dot-${localOk ? "ok" : ready ? "warn" : "mute"}`}
        />
        <span className="ev-link-label">
          {ready ? (storageError ? "Degraded" : "IndexedDB") : "Mounting…"}
        </span>
      </div>
      <div className="ev-link-row">
        <span>Subsystem · Cloud</span>
        <span className={`ev-dot ev-dot-${cloudTone}`} />
        <span className="ev-link-label">{cloudLabel}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--color-ev-muted)",
          paddingTop: 2,
        }}
      >
        <span>Model</span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "#35e0ff",
            maxWidth: 130,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={openRouterModel || "anthropic/claude-3.5-sonnet"}
        >
          {(openRouterModel || "anthropic/claude-3.5-sonnet").split("/").pop()}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--color-ev-muted)",
          paddingTop: 2,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Mic style={{ width: 11, height: 11, color: "inherit" }} />
          Wake Word
        </span>
        {/* Wake word parked — Coming Soon: muted label, no mic behavior. */}
        <span
          title="Wake word coming soon"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "transparent",
            border: "1px solid var(--color-ev-line)",
            padding: "2px 6px",
            borderRadius: 4,
            color: "var(--color-ev-muted)",
            fontSize: 10.5,
          }}
        >
          <span className="ev-dot ev-dot-mute" />
          Coming Soon
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button
          type="button"
          className="ev-icon-btn"
          onClick={recheckBackend}
          title="Re-probe the backend route"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <RefreshCw style={{ width: 12, height: 12 }} /> Probe
        </button>
        <button
          type="button"
          className="ev-icon-btn"
          onClick={openSettings}
          title="Configure API key and model"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Settings style={{ width: 12, height: 12 }} /> Config
        </button>
      </div>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const clock = useClock();
  const { openSettings } = useEv();

  const current = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <aside className="ev-side" aria-label="Primary">
        <div className="ev-brand">
          <span className="ev-brand-mark">EV</span>
          <span>
            <span className="ev-brand-name">E.V.</span>
            <br />
            <span className="ev-brand-sub">Alfarez Console</span>
          </span>
        </div>
        <nav className="ev-nav">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={current(href) ? "page" : undefined}
            >
              <Icon /> {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={openSettings}
            aria-label="Open model and API key settings"
          >
            <Settings /> Settings
          </button>
        </nav>
        <div className="ev-side-foot">
          <LinkStatus />
          <p className="ev-clock" aria-label="Local time">
            {clock} LOCAL
          </p>
        </div>
      </aside>
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
        <button
          type="button"
          onClick={openSettings}
          aria-label="Open model and API key settings"
        >
          <Settings /> Settings
        </button>
      </nav>
      <SettingsModal />
    </>
  );
}
