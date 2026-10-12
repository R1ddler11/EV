/* PROJECT E.V. — deterministic diagnostics simulation (frontend-owned).
   Every value below is derived from a fixed seed, so renders are stable
   and the suite is reproducible. Nothing here measures real hardware.
   The simulation layer is intentionally isolated: future real integrations
   replace `DIAGNOSTICS` / `runSimulatedScan` without touching the panel. */

import type { DiagnosticResult, DiagnosticStatus } from "./types";

/** Mulberry32 — small seeded PRNG so sample data never shifts between renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xE5017A);
const pct = (base: number, spread: number) =>
  `${(base + rand() * spread).toFixed(1)}%`;

export const DIAGNOSTICS: DiagnosticResult[] = [
  {
    key: "power",
    label: "Power Cell",
    status: "nominal",
    value: pct(96, 2),
    detail: "Arc output steady. Thermal envelope within tolerance.",
    simulated: true,
  },
  {
    key: "suit",
    label: "Suit Integrity",
    status: "nominal",
    value: pct(98, 1.2),
    detail: "Plating nominal across 214 zones. Micro-abrasions cosmetic only.",
    simulated: true,
  },
  {
    key: "targeting",
    label: "Targeting Matrix",
    status: "nominal",
    value: "0.4 mrad",
    detail: "Calibration drift 0.4 mrad. Re-zero due in 36 hours.",
    simulated: true,
  },
  {
    key: "sensors",
    label: "Sensor Calibration",
    status: "degraded",
    value: pct(81, 3),
    detail:
      "Lidar array B reports intermittent noise. Recalibration recommended.",
    simulated: true,
  },
  {
    key: "network",
    label: "Network Link",
    status: "nominal",
    value: `${Math.floor(12 + rand() * 6)} ms`,
    detail: "Uplink stable. Packet loss below measurable threshold.",
    simulated: true,
  },
  {
    key: "processing",
    label: "Processing Core",
    status: "nominal",
    value: pct(22, 8),
    detail: "Load nominal. Headroom reserved for voice pipeline.",
    simulated: true,
  },
  {
    key: "health",
    label: "System Health",
    status: "nominal",
    value: pct(94, 3),
    detail: "Aggregate of subsystems. One degraded item under watch.",
    simulated: true,
  },
];

export const SCAN_STEPS = [
  "Spinning up diagnostic bus",
  "Polling power cell",
  "Sweeping suit zones",
  "Verifying targeting matrix",
  "Calibrating sensor arrays",
  "Probing network link",
  "Compiling summary",
] as const;

export const STATUS_META: Record<
  DiagnosticStatus,
  { label: string; className: string }
> = {
  nominal: { label: "Nominal", className: "text-ev-cyan" },
  degraded: { label: "Degraded", className: "text-amber-300" },
  standby: { label: "Standby", className: "text-ev-muted" },
};

export const SCAN_DURATION_MS = 5200;
