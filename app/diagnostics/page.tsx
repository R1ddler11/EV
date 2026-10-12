/* PROJECT E.V. — Diagnostics panel (frontend-owned).
   Deterministic SIMULATED demo: seeded sample data, scan progress with
   GSAP, summary. The simulation layer (lib/diagnostics.ts) is isolated so
   future real integrations can replace it without touching this panel. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Play, RotateCcw } from "lucide-react";
import { SectionLabel, StatusPill } from "@/components/ui";
import {
  DIAGNOSTICS,
  SCAN_DURATION_MS,
  SCAN_STEPS,
  STATUS_META,
} from "@/lib/diagnostics";
import { motionAllowed } from "@/lib/motion";
import { useEv } from "@/lib/store";

export default function DiagnosticsPage() {
  const { settings, recordActivity, setCoreState, scanRequest } = useEv();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const reduced = !motionAllowed(settings.reducedMotionOverride);

  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    },
    [],
  );

  useGSAP(() => {
    if (!running || reduced || !fillRef.current) return;
    const tween = gsap.fromTo(
      fillRef.current,
      { width: "0%" },
      {
        width: "100%",
        duration: SCAN_DURATION_MS / 1000,
        ease: "power1.inOut",
        onUpdate() {
          setProgress(Math.round((this.progress() ?? 0) * 100));
        },
      },
    );
    return () => {
      tween.kill();
    };
  }, [running, reduced]);

  const run = useCallback(async () => {
    if (running) return;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setRunning(true);
    setDone(false);
    setProgress(0);
    setStepIndex(0);
    setCoreState("processing");

    if (reduced) {
      // No animation: step through instantly but keep the honest sequence.
      SCAN_STEPS.forEach((_, i) => {
        timers.current.push(window.setTimeout(() => setStepIndex(i + 1), i * 120));
      });
      timers.current.push(
        window.setTimeout(() => {
          setProgress(100);
          setRunning(false);
          setDone(true);
          setCoreState("idle");
          void recordActivity("diagnostic", "Diagnostic sweep complete", "7 systems, 1 degraded");
        }, SCAN_STEPS.length * 120 + 200),
      );
      return;
    }

    const per = SCAN_DURATION_MS / SCAN_STEPS.length;
    SCAN_STEPS.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setStepIndex(i + 1), i * per));
    });
    timers.current.push(
      window.setTimeout(() => {
        setRunning(false);
        setDone(true);
        setCoreState("idle");
        void recordActivity("diagnostic", "Diagnostic sweep complete", "7 systems, 1 degraded");
      }, SCAN_DURATION_MS + 150),
    );
  }, [running, reduced, recordActivity, setCoreState]);

  /* Assistant tool-action scan requests: auto-run when idle. The counter is
     ephemeral store state, incremented by requestScan() via handleUiAction. */
  const seenScan = useRef(0);
  useEffect(() => {
    if (scanRequest > seenScan.current && !running) {
      seenScan.current = scanRequest;
      void run();
    }
  }, [scanRequest, running, run]);

  const degraded = DIAGNOSTICS.filter((d) => d.status !== "nominal");

  return (
    <div className="ev-stack">
      <header className="ev-page-head">
        <SectionLabel>E.V. // Diagnostics</SectionLabel>
        <h1 className="ev-h1">System diagnostics</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusPill tone="warn">Demo · Simulated</StatusPill>
          <StatusPill tone="mute">Deterministic sample data</StatusPill>
        </div>
        <p className="ev-lede">
          A fixed simulation for the demo build — values are seeded, stable
          across renders, and measure nothing real. The simulation layer is
          isolated for future live integrations.
        </p>
      </header>

      <section className="ev-panel" aria-label="Scan control">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <SectionLabel>Deep Sweep · ~5s</SectionLabel>
            <p className="ev-hint" style={{ marginTop: 4 }}>
              {running
                ? `Scanning — ${SCAN_STEPS[Math.min(stepIndex, SCAN_STEPS.length - 1)]}…`
                : done
                  ? "Sweep complete. Summary below."
                  : "Polls all seven subsystems in sequence."}
            </p>
          </div>
          <button
            type="button"
            className="ev-btn ev-btn-primary"
            disabled={running}
            onClick={() => void run()}
          >
            {done ? <RotateCcw /> : <Play />} {done ? "Run again" : running ? `Scanning ${progress}%` : "Run scan"}
          </button>
        </div>
        <div className="ev-scan-track" style={{ marginTop: 12 }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Scan progress">
          <div ref={fillRef} className="ev-scan-fill" style={reduced ? { width: `${progress}%` } : undefined} />
        </div>
        {running && (
          <ol className="ev-mono" style={{ marginTop: 10, fontSize: 11.5, color: "#8d99a6", display: "flex", flexDirection: "column", gap: 3 }}>
            {SCAN_STEPS.map((step, i) => (
              <li key={step} style={{ color: i < stepIndex ? "#35e0ff" : undefined }}>
                {i < stepIndex ? "✓" : "·"} {step}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ev-panel" aria-label="Subsystem results">
        <SectionLabel>Subsystems</SectionLabel>
        <div style={{ marginTop: 4 }}>
          {DIAGNOSTICS.map((d) => (
            <div className="ev-diag-row" key={d.key}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>{d.label}</div>
                <div style={{ fontSize: 12.5, color: "#8d99a6", marginTop: 2 }}>{d.detail}</div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <span className={`ev-mono ${STATUS_META[d.status].className}`} style={{ fontSize: 12.5 }}>
                  {d.value}
                </span>
                <StatusPill tone={d.status === "nominal" ? "ok" : d.status === "degraded" ? "warn" : "mute"}>
                  {STATUS_META[d.status].label}
                </StatusPill>
              </div>
            </div>
          ))}
        </div>
      </section>

      {done && (
        <section className="ev-panel" aria-label="Scan summary">
          <SectionLabel>Summary</SectionLabel>
          <p className="ev-lede" style={{ marginTop: 6, fontSize: 13.5 }}>
            7 subsystems polled · {DIAGNOSTICS.length - degraded.length} nominal
            {degraded.length > 0 && (
              <>
                {" "}· {degraded.length} degraded:{" "}
                {degraded.map((d) => d.label).join(", ")} — recalibration
                recommended before field use.
              </>
            )}
            {degraded.length === 0 && " — no action required."}
          </p>
        </section>
      )}
    </div>
  );
}
