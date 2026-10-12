/* PROJECT E.V. — animated core (frontend-owned).
   Original SVG: concentric technical rings + faint spider-thread radials.
   State-driven color/behavior for 8 states. Ambient motion is CSS-only;
   GSAP is reserved for activation transitions (handled by parent).
   Reduced-motion: static rings, no rotation/pulse. */
"use client";

import { useId } from "react";
import type { CoreState } from "@/lib/types";

const STATE_META: Record<
  CoreState,
  { label: string; stroke: string; glow: boolean; spin: string }
> = {
  idle: { label: "Idle", stroke: "#35e0ff", glow: false, spin: "ev-spin-slow" },
  connecting: { label: "Connecting", stroke: "#f5b942", glow: false, spin: "ev-spin-med" },
  listening: { label: "Listening", stroke: "#35e0ff", glow: false, spin: "ev-spin-med" },
  processing: { label: "Processing", stroke: "#5b8cff", glow: false, spin: "ev-spin-fast" },
  // Red accent is rationed: speaking is one of the two allowed focus glows.
  speaking: { label: "Speaking", stroke: "#e0342b", glow: true, spin: "ev-spin-med" },
  interrupted: { label: "Interrupted", stroke: "#f5b942", glow: false, spin: "" },
  disconnected: { label: "Disconnected", stroke: "#5b6470", glow: false, spin: "" },
  error: { label: "Error", stroke: "#e0342b", glow: true, spin: "" },
};

export default function EvCore({
  state,
  size = 240,
  reducedMotion = false,
}: {
  state: CoreState;
  size?: number;
  reducedMotion?: boolean;
}) {
  const meta = STATE_META[state];
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const spinClass = reducedMotion ? "" : meta.spin;
  // Fine spider-web geometry: 8 hairline radials, kept at 8% opacity.
  const threads = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

  return (
    <div
      className="ev-core"
      role="img"
      aria-label={`E.V. core — ${meta.label}`}
      data-state={state}
      data-glow={meta.glow}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        className={spinClass}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`corefill-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={meta.stroke} stopOpacity="0.28" />
            <stop offset="55%" stopColor={meta.stroke} stopOpacity="0.06" />
            <stop offset="100%" stopColor={meta.stroke} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill={`url(#corefill-${uid})`} />
        {threads.map((angle, i) => (
          <line
            key={i}
            x1={100 - 92 * Math.cos(angle)}
            y1={100 - 92 * Math.sin(angle)}
            x2={100 + 92 * Math.cos(angle)}
            y2={100 + 92 * Math.sin(angle)}
            stroke="#9fb2c5"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
        ))}
        <circle
          cx="100"
          cy="100"
          r="92"
          fill="none"
          stroke="#2a333e"
          strokeWidth="1"
        />
        <circle
          cx="100"
          cy="100"
          r="74"
          fill="none"
          stroke={meta.stroke}
          strokeOpacity="0.55"
          strokeWidth="1.25"
          strokeDasharray="46 14"
        />
        <circle
          cx="100"
          cy="100"
          r="58"
          fill="none"
          stroke="#2a333e"
          strokeWidth="1"
        />
        <circle
          cx="100"
          cy="100"
          r="44"
          fill="none"
          stroke={meta.stroke}
          strokeOpacity="0.85"
          strokeWidth="1.5"
          strokeDasharray="20 9"
        />
        {/* Tri-arc hub: E.V. mark, not a generic orb. */}
        {[0, 120, 240].map((deg) => (
          <path
            key={deg}
            d="M 100 78 A 22 22 0 0 1 119 111"
            fill="none"
            stroke={meta.stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            transform={`rotate(${deg} 100 100)`}
          />
        ))}
        <circle cx="100" cy="100" r="7" fill={meta.stroke} />
        <circle
          cx="100"
          cy="100"
          r="7"
          fill="none"
          stroke="#0b0d10"
          strokeWidth="1.5"
        />
      </svg>
      <div className="ev-core-readout">
        <span className="ev-core-dot" style={{ background: meta.stroke }} />
        <span>{meta.label}</span>
      </div>
    </div>
  );
}
