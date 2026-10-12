/* PROJECT E.V. — live input/output level meters (voice-owned).
   Both bars are driven by an AnalyserNode on the real MediaStream (mic or
   E.V.'s returned track) — no synthetic animation. The rAF loop writes the
   transform directly to the DOM node so a low-powered box never re-renders
   React 60 times a second. */

"use client";

import { useEffect, useRef } from "react";

interface LevelMeterProps {
  stream: MediaStream | null;
  label: string;
  tone: "in" | "out";
}

/** dBFS window mapped to 0..1 — -55 dBFS floor, 0 dBFS full scale. */
const FLOOR_DB = -55;
const RANGE_DB = 45;

export default function LevelMeter({ stream, label, tone }: LevelMeterProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !stream || stream.getAudioTracks().length === 0) return;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let peak = 0.02;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = ((data[i] ?? 128) - 128) / 128;
        sum += sample * sample;
      }
      const db = 20 * Math.log10(Math.sqrt(sum / data.length) + 1e-7);
      const level = Math.min(1, Math.max(0, (db - FLOOR_DB) / RANGE_DB));
      // Fast attack, slow release so short words stay visible.
      peak = level > peak ? level : peak * 0.88;
      bar.style.transform = `scaleX(${Math.max(0.02, peak).toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);

  const color = tone === "in" ? "#35e0ff" : "#7cf5b0";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-ev-muted)",
          minWidth: 74,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid var(--color-ev-line)",
          overflow: "hidden",
        }}
      >
        <div
          ref={barRef}
          style={{
            height: "100%",
            width: "100%",
            transformOrigin: "left center",
            transform: "scaleX(0.02)",
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      </div>
    </div>
  );
}