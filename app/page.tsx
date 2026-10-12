/* PROJECT E.V. — Main Overview (frontend-owned).
   Identity + separate local/cloud indicators, local time, animated core,
   voice entry, quick text input, diagnostics summary, real activity feed,
   suggested actions. Every control works; empty states are honest. */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Mic, Plus, Send, Stethoscope, Square } from "lucide-react";
import EvCore from "@/components/ev-core";
import CloudPill from "@/components/cloud-pill";
import { SectionLabel, StatusPill } from "@/components/ui";
import { ChatFailureNotice, useChat } from "@/components/chat";
import { DIAGNOSTICS, STATUS_META } from "@/lib/diagnostics";
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
  const router = useRouter();
  const {
    ready,
    storageError,
    coreState,
    backendReachable,
    backendHint,
    recheckBackend,
    activity,
    settings,
    recordActivity,
  } = useEv();
  const { draft, working, failure, setFailure, send, stop } = useChat();
  const [input, setInput] = useState("");
  const [lastSent, setLastSent] = useState("");
  const root = useRef<HTMLDivElement>(null);
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

  // Leave the core activation flourish to the core itself; overview only
  // animates panel entrances.

  const quickSend = async (text: string) => {
    const ok = await send(text);
    if (ok) {
      await recordActivity("chat", "Exchange started from Overview");
      router.push("/assistant");
    }
  };

  const degraded = DIAGNOSTICS.filter((d) => d.status !== "nominal").length;
  const recent = activity.slice(0, 6);

  return (
    <div ref={root} className="ev-stack">
      <header className="ev-page-head ev-enter">
        <SectionLabel>E.V. // Personal Companion — Operator Alfarez</SectionLabel>
        <h1 className="ev-h1">Good to see you, Alfarez.</h1>
        <p className="ev-lede">
          Your console for conversation, voice, system checks and memory —
          everything below reads from live local state. Nothing here is staged.
        </p>
      </header>

      {failure && (
        <ChatFailureNotice
          failure={failure}
          onRetry={() => lastSent && quickSend(lastSent)}
          onDismiss={() => setFailure(null)}
        />
      )}

      <div className="ev-grid-2">
        <section className="ev-panel ev-enter" aria-label="E.V. status">
          <SectionLabel>Core Status</SectionLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              padding: "10px 0 4px",
            }}
          >
            <EvCore state={coreState} size={220} reducedMotion={reduced} />
            <p className="ev-clock" aria-label="Local time">
              {clock.time} · {clock.date}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {storageError || !ready ? (
                <StatusPill tone="warn">Local · Degraded</StatusPill>
              ) : (
                <StatusPill tone="ok">Local · Ready</StatusPill>
              )}
              <CloudPill />
            </div>
            {backendHint && backendReachable && (
              <p className="ev-hint" style={{ textAlign: "center", maxWidth: 44 * 8 }}>
                {backendHint}
              </p>
            )}
            {backendReachable === false && (
              <button
                type="button"
                className="ev-btn ev-btn-sm"
                onClick={recheckBackend}
              >
                Recheck cloud link
              </button>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/voice" className="ev-btn ev-btn-primary">
                <Mic /> Enter voice mode
              </Link>
              <Link href="/assistant" className="ev-btn">
                Open assistant
              </Link>
            </div>
          </div>
        </section>

        <section className="ev-panel ev-enter" aria-label="Quick message">
          <SectionLabel>Quick Message</SectionLabel>
          <h2 className="ev-h2" style={{ margin: "6px 0" }}>
            Ask E.V. anything
          </h2>
          <p className="ev-lede" style={{ fontSize: 13 }}>
            Sends into your active thread and hands you to the Assistant for
            the full exchange.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <textarea
              className="ev-textarea"
              rows={3}
              aria-label="Quick message to E.V."
              placeholder="Type here — Enter to send, Shift+Enter for newline"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = input.trim();
                  if (text && !working) {
                    setLastSent(text);
                    setInput("");
                    void quickSend(text);
                  }
                }
              }}
            />
            <div className="ev-composer-bar">
              <span className="ev-hint">
                {working || draft ? "E.V. is responding…" : "Replies stream in the Assistant"}
              </span>
              {working ? (
                <button type="button" className="ev-btn ev-btn-sm" onClick={() => void stop()}>
                  <Square /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="ev-btn ev-btn-primary ev-btn-sm"
                  disabled={!input.trim()}
                  onClick={() => {
                    const text = input.trim();
                    setLastSent(text);
                    setInput("");
                    void quickSend(text);
                  }}
                >
                  <Send /> Send
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="ev-grid-2">
        <section className="ev-panel ev-enter" aria-label="Diagnostics summary">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <SectionLabel>Diagnostics · Simulated Demo</SectionLabel>
            <Link href="/diagnostics" className="ev-icon-btn">
              Full panel <ArrowRight />
            </Link>
          </div>
          <div style={{ marginTop: 6 }}>
            {DIAGNOSTICS.slice(0, 4).map((d) => (
              <div className="ev-diag-row" key={d.key}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label}</span>
                <span className={`ev-mono ${STATUS_META[d.status].className}`} style={{ fontSize: 12 }}>
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
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
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
  );
}
