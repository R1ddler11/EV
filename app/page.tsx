/* PROJECT E.V. — Home (frontend-owned).
   The orb hero: the ask surface with its full
   processing choreography (launch → assemble →
   think → resolve → condense → unfold) is the home
   experience, wired through the shared orb turn.
   Below the hero, the overview's real content as
   restrained black sections with hairline borders —
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
    time: now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    date: now.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  };
}

const QUICK_ACTIONS = [
  { label: "Start a new exchange", href: "/assistant?new=1", icon: Plus },
  { label: "Enter voice mode", href: "/voice", icon: Mic },
  { label: "Run system diagnostics", href: "/diagnostics", icon: Stethoscope },
  { label: "Review memory vault", href: "/memory", icon: ArrowRight },
];

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
  // The hero's ask surface runs the shared orb
  // turn — the same implementation the assistant's
  // empty state uses.
  const { orbSubmit } = useOrbTurn({
    activityLabel: "Exchange started from Overview",
  });
  const clock = useClock();
  const reduced = !motionAllowed(settings.reducedMotionOverride);

  useGSAP(
    () => {
      if (reduced || !root.current) return;
      const ctx = gsap.context(() => {
        gsap.from(".ev-enter", {
          opacity: 0,
          y: 18,
          duration: 0.6,
          stagger: 0.08,
          ease: "power2.out",
          clearProps: "all",
        });
      }, root);
      return () => ctx.revert();
    },
    { scope: root, dependencies: [ready] },
  );

  const degraded = DIAGNOSTICS.filter((d) => d.status !== "nominal").length;
  const recent = activity.slice(0, 6);

  return (
    <div ref={root}>
      {/* The hero: the ask surface and its full
          processing choreography. The orb component
          is a fixed full-viewport surface by design;
          .orb-hero scopes it to this section so the
          restrained sections below stay reachable. */}
      <section className="orb-hero" aria-label="Ask E.V.">
        <MorphOrb onSubmit={orbSubmit} />
      </section>

      <div className="ev-stack" style={{ marginTop: 14 }}>
        <section className="ev-panel ev-enter" aria-label="E.V. status">
          <SectionLabel>Status</SectionLabel>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              marginTop: 8,
            }}
          >
            <LinkStatus />
            <p
              className="ev-clock"
              aria-label="Local time"
              style={{ margin: "0 0 0 auto" }}
            >
              {clock.time} · {clock.date}
            </p>
          </div>
          {backendHint && backendReachable && (
            <p className="ev-hint" style={{ marginTop: 10 }}>
              {backendHint}
            </p>
          )}
          {backendReachable === false && (
            <button
              type="button"
              className="ev-btn ev-btn-sm"
              style={{ marginTop: 10 }}
              onClick={recheckBackend}
            >
              Recheck cloud link
            </button>
          )}
        </section>

        <div className="ev-grid-2">
          <section className="ev-panel ev-enter" aria-label="Diagnostics summary">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <SectionLabel>Diagnostics · Simulated Demo</SectionLabel>
              <Link href="/diagnostics" className="ev-icon-btn">
                Full panel <ArrowRight />
              </Link>
            </div>
            <div style={{ marginTop: 6 }}>
              {DIAGNOSTICS.slice(0, 4).map((d) => (
                <div className="ev-diag-row" key={d.key}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {d.label}
                  </span>
                  <span
                    className={`ev-mono ${STATUS_META[d.status].className}`}
                    style={{ fontSize: 12 }}
                  >
                    {STATUS_META[d.status].label} · {d.value}
                  </span>
                </div>
              ))}
            </div>
            <p className="ev-hint" style={{ marginTop: 10 }}>
              {degraded === 0
                ? "All sampled subsystems nominal."
                : `${degraded} sampled subsystem${degraded > 1 ? "s" : ""} degraded — see the full panel.`}{" "}
              Sample data, deterministic.
            </p>
          </section>

          <section className="ev-panel ev-enter" aria-label="Recent activity">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <SectionLabel>Recent Activity</SectionLabel>
              <Link href="/memory" className="ev-icon-btn">
                Vault <ArrowRight />
              </Link>
            </div>
            <div style={{ marginTop: 6 }}>
              {recent.length === 0 ? (
                <div className="ev-empty">
                  <span>No activity yet.</span>
                  <span className="ev-hint">
                    Chat, run diagnostics, or save a note — it will appear here.
                  </span>
                </div>
              ) : (
                recent.map((entry) => (
                  <div className="ev-activity-row" key={entry.id}>
                    <span
                      className="ev-mono"
                      style={{ fontSize: 10.5, color: "#5b6470", flex: "none" }}
                    >
                      {new Date(entry.at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>
                      <strong style={{ fontWeight: 600 }}>{entry.label}</strong>
                      {entry.detail && (
                        <span style={{ color: "#8d99a6" }}> — {entry.detail}</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="ev-panel ev-enter" aria-label="Suggested actions">
          <SectionLabel>Suggested Actions</SectionLabel>
          <div className="ev-suggest-row" style={{ marginTop: 10 }}>
            {QUICK_ACTIONS.map(({ label, href, icon: Icon }) => (
              <Link key={label} href={href} className="ev-btn">
                <Icon /> {label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
