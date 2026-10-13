/* PROJECT E.V. — Home (frontend-owned).
   The orb hero: the ask surface with its full
   processing choreography (launch → assemble →
   think → resolve → condense → unfold) is the home
   experience, wired through the shared orb turn.
   Below the hero, the overview's real content as
   restrained black panels with hairline borders —
   status pills, live clock, diagnostics summary,
   activity feed and quick actions. Every control
   works; empty states are honest. */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Mic, Plus, Stethoscope } from "lucide-react";
import { LinkStatus } from "@/components/nav";
import { SectionLabel } from "@/components/ui";
import MorphOrb from "@/components/ui/ai-thiking-orb-and-input";
import { DIAGNOSTICS, STATUS_META } from "@/lib/diagnostics";
import { useOrbTurn } from "@/lib/use-orb-turn";
import { motionAllowed } from "@/lib/motion";
import { useEv } from "@/lib/store";

/** Live clock hook — updates every second. */
function useClock(): { time: string; date: string } {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return { time: "--:--:--", date: "Loading live clock…" };
  }
  return {
    time: now.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    date: now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }),
  };
}

/** Quick actions as real routes — primary CTA gets inverted button. */
const QUICK_ACTIONS = [
  { label: "Start a new exchange", href: "/assistant?new=1", icon: Plus, primary: true },
  { label: "Enter voice mode", href: "/voice", icon: Mic, primary: false },
  { label: "Run system diagnostics", href: "/diagnostics", icon: Stethoscope, primary: false },
  { label: "Review memory vault", href: "/memory", icon: ArrowRight, primary: false },
] as const;

export default function OverviewPage() {
  const root = useRef<HTMLDivElement>(null);
  const {
    ready,
    backendReachable,
    backendHint,
    recheckBackend,
    activity,
    settings,
  } = useEv();

  const { orbSubmit } = useOrbTurn({
    activityLabel: "Exchange started from Overview",
  });
  const clock = useClock();
  const reduced = !motionAllowed(settings.reducedMotionOverride);

  /** Declare RHYTHM dial — section spacing ladder. */
  const rhythm = {
    xs: 8,
    sm: 14,
    md: 22,
    lg: 32,
    xl: 48,
  } as const;

  /** GSAP entrance animations for sections below hero. */
  useGSAP(
    () => {
      if (reduced) return;
      const ctx = gsap.context(() => {
        gsap.from(".ev-enter", {
          y: 16,
          opacity: 0,
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.08,
        });
      }, root);
      return () => ctx.revert();
    },
    { scope: root, dependencies: [ready, reduced] },
  );

  const degraded = DIAGNOSTICS.filter((d) => d.status !== "nominal").length;
  const recent = activity.slice(0, 6);

  return (
    <div ref={root} className="ev-main">
      {/* ── HERO: MorphOrb centerpiece, full viewport height ── */}
      <section className="orb-hero" aria-label="Ask E.V.">
        <MorphOrb onSubmit={orbSubmit} />
      </section>

      {/* ── SECTIONS: restrained black panels with hairline borders ── */}
      <div className="ev-stack" style={{ gap: rhythm.lg, paddingBottom: rhythm.xl }}>
        {/* STATUS: LinkStatus pills + live clock */}
        <section className="ev-panel ev-enter" aria-labelledby="status-heading">
          <SectionLabel id="status-heading">Status</SectionLabel>
          <div className="ev-status-row" style={{ marginTop: rhythm.sm }}>
            <LinkStatus />
            <p className="ev-clock" aria-label="Local time">{clock.time} · {clock.date}</p>
          </div>
          {backendHint && backendReachable && (
            <p className="ev-hint" style={{ marginTop: rhythm.xs }}>
              {backendHint}
            </p>
          )}
          {backendReachable === false && (
            <button
              type="button"
              className="ev-btn ev-btn-sm"
              style={{ marginTop: rhythm.xs }}
              onClick={recheckBackend}
            >
              Recheck cloud link
            </button>
          )}
        </section>

        {/* DIAGNOSTICS SUMMARY + RECENT ACTIVITY side by side */}
        <div className="ev-grid-2" style={{ gap: rhythm.md }}>
          {/* DIAGNOSTICS SUMMARY: 4 key metrics, degraded count, link to full panel */}
          <section className="ev-panel ev-enter" aria-labelledby="diag-heading">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <SectionLabel id="diag-heading">Diagnostics · Simulated Demo</SectionLabel>
              <Link href="/diagnostics" className="ev-icon-btn" aria-label="Open full diagnostics panel">
                <span>Full panel</span>
                <ArrowRight aria-hidden="true" style={{ width: 14, height: 14 }} />
              </Link>
            </div>
            <div style={{ marginTop: rhythm.xs }}>
              {DIAGNOSTICS.slice(0, 4).map((d) => (
                <div className="ev-diag-row" key={d.key}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label}</span>
                  <span className={`ev-mono ${STATUS_META[d.status].className}`} style={{ fontSize: 12 }}>
                    {STATUS_META[d.status].label} · {d.value}
                  </span>
                </div>
              ))}
            </div>
            <p className="ev-hint" style={{ marginTop: rhythm.xs }}>
              {degraded === 0
                ? "All sampled subsystems nominal."
                : `${degraded} sampled subsystem${degraded > 1 ? "s" : ""} degraded — see the full panel.`}
              {" "}
              <span style={{ color: "var(--color-ev-faint)" }}>Sample data, deterministic.</span>
            </p>
          </section>

          {/* RECENT ACTIVITY: real feed, honest empty state */}
          <section className="ev-panel ev-enter" aria-labelledby="activity-heading">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <SectionLabel id="activity-heading">Recent Activity</SectionLabel>
              <Link href="/memory" className="ev-icon-btn" aria-label="Open memory vault">
                <span>Vault</span>
                <ArrowRight aria-hidden="true" style={{ width: 14, height: 14 }} />
              </Link>
            </div>
            <div style={{ marginTop: rhythm.xs }}>
              {recent.length === 0 ? (
                <div className="ev-empty" role="status" aria-live="polite">
                  <span style={{ fontWeight: 600 }}>No activity yet.</span>
                  <span className="ev-hint">
                    Chat, run diagnostics, or save a note — it will appear here.
                  </span>
                </div>
              ) : (
                recent.map((entry) => (
                  <div className="ev-activity-row" key={entry.id}>
                    <time
                      className="ev-mono"
                      style={{ fontSize: 10.5, color: "var(--color-ev-faint)", flex: "none" }}
                      dateTime={new Date(entry.at).toISOString()}
                    >
                      {new Date(entry.at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>
                      <strong style={{ fontWeight: 600 }}>{entry.label}</strong>
                      {entry.detail && (
                        <span style={{ color: "var(--color-ev-muted)" }}> — {entry.detail}</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* QUICK ACTIONS: real routes as buttons, primary CTA inverted */}
        <section className="ev-panel ev-enter" aria-labelledby="actions-heading">
          <SectionLabel id="actions-heading">Quick Actions</SectionLabel>
          <div className="ev-suggest-row" style={{ marginTop: rhythm.sm, gap: rhythm.xs }}>
            {QUICK_ACTIONS.map(({ label, href, icon: Icon, primary }) => (
              <Link
                key={label}
                href={href}
                className={`ev-btn ${primary ? "ev-btn-primary" : ""}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <Icon aria-hidden="true" style={{ width: 16, height: 16 }} />
                {label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}