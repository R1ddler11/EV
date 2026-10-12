"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

/* ------------------------------------------------------------------ */
/* Prompt dictionary                                                   */
/* ------------------------------------------------------------------ */

const dl = {
  placeholder: "Ask anything…",
  labels: ["Thinking", "Searching", "Analyzing", "Composing"],
  done: "Done",
  answerTitle: "Answer",
  answerBody: "The answer goes here",
  reset: "New question",
  send: "Send",
} as const;

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const RING_R = 60;
const PILL = 60;
const BALL = 132;
const RING_X = 66;
const ORB = 220;
const CARD_H = 108;
const CARD_W = 138;

const pillW = () => Math.min(560, window.innerWidth - 32);
const cardW = () => Math.min(320, window.innerWidth - 32);
const homeDy = () => window.innerHeight * 0.54 - 96;

/* ------------------------------------------------------------------ */
/* Math                                                                */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fmt = (v: number) => String(Math.round(v * 1e4) / 1e4);
const TAU = Math.PI * 2;

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const ax = 3 * x1;
  const bx = 3 * (x2 - x1) - ax;
  const cx = 1 - ax - bx;
  const ay = 3 * y1;
  const by = 3 * (y2 - y1) - ay;
  const cy = 1 - ay - by;
  const sx = (t: number) => ((cx * t + bx) * t + ax) * t;
  const sy = (t: number) => ((cy * t + by) * t + ay) * t;
  const dx = (t: number) => (3 * cx * t + 2 * bx) * t + ax;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const e = sx(t);
      if (Math.abs(e - x) < 1e-6) break;
      if (x > e) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
    }
    return t;
  };
  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
}

type Ease = (t: number) => number;

const E = {
  out: cubicBezier(0.22, 1, 0.36, 1),
  io: cubicBezier(0.65, 0, 0.35, 1),
  in: cubicBezier(0.4, 0, 1, 1),
  fly: cubicBezier(0.5, 0, 0.1, 1),
  grow: cubicBezier(0.3, 0, 0.2, 1),
  vortex: cubicBezier(0.6, 0, 0.2, 1),
  spring: cubicBezier(0.34, 1.4, 0.64, 1),
  card: cubicBezier(0.65, 0, 0.2, 1),
  lin: (t: number) => t,
};

const bez = (t: number, p0: number, p1: number, p2: number) =>
  (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

/* ------------------------------------------------------------------ */
/* Timeline tracks                                                     */
/* ------------------------------------------------------------------ */

interface Track {
  ch: string;
  from: number;
  to: number;
  t0: number;
  t1: number;
  ease?: Ease;
}

const T = (
  ch: string,
  from: number,
  to: number,
  t0: number,
  t1: number,
  ease: Ease = E.io,
): Track => ({ ch, from, to, t0, t1, ease });

const launchTracks = (d: { pw: number }) => [
  T("w", d.pw, d.pw - 12, 0, 100, E.out),
  T("oInput", 1, 0, 0, 160, E.in),
  T("inScale", 1, 0.6, 0, 160, E.in),
  T("oGlow", 1, 0, 0, 300, E.out),
  T("oAur", 1, 0, 0, 300, E.out),
  T("w", d.pw - 12, PILL, 100, 560, E.io),
  T("h", RING_R, RING_R + 6, 380, 500, E.out),
  T("h", RING_R + 6, PILL, 500, 620, E.out),
  T("oPill", 1, 0, 300, 560, E.out),
  T("oBall", 0, 1, 300, 560, E.out),
  T("u", 0, 1, 620, 1500, E.fly),
  T("w", PILL, CARD_W, 620, 1300, E.grow),
  T("h", PILL, CARD_W, 620, 1300, E.grow),
  T("w", CARD_W, BALL, 1300, 1500, E.out),
  T("h", CARD_W, BALL, 1300, 1500, E.out),
  T("cHalo", 0, 0.6, 620, 1500, E.out),
  T("trail", 0, 1, 700, 800, E.out),
  T("trail", 1, 0, 1300, 1500, E.in),
];

const assembleTracks = [
  T("oRing", 1, 0, 0, 300, E.out),
  T("oBall", 1, 0, 0, 260, E.out),
  T("orb.k", 0, 1, 0, 800, E.out),
  T("orb.alpha", 0, 1, 0, 800, E.out),
  T("orb.spin", 0, 0.9, 0, 800, E.out),
  T("orb.pop", 1, 1.05, 0, 420, E.out),
  T("orb.pop", 1.05, 1, 420, 800, E.io),
  T("sOp", 0, 1, 300, 620, E.out),
  T("sTy", 6, 0, 300, 620, E.out),
];

const resolveTracks = [
  T("orb.sweep", 0, 1, 0, 700, E.io),
  T("orb.spin", 0.9, 0.3, 0, 700, E.out),
  T("orb.gain", 1, 0, 0, 700, E.out),
  T("orb.floor", 0, 0.95, 400, 900, E.out),
  T("orb.rad", 0, 0.15, 400, 900, E.out),
  T("orb.pop", 1, 1.04, 600, 800, E.out),
  T("orb.pop", 1.04, 1, 800, 900, E.out),
];

const condenseTracks = [
  T("orb.pop", 1, 1.06, 0, 120, E.out),
  T("sOp", 1, 0, 0, 160, E.in),
  T("sTy", 0, -6, 0, 160, E.in),
  T("orb.k", 1, 0, 120, 640, E.vortex),
  T("orb.vortex", 0, 1.6, 120, 640, E.vortex),
  T("oGreen", 0, 1, 260, 700, E.spring),
  T("gs", 0.55, 1, 260, 700, E.spring),
  T("pulse", 0, 1, 320, 760, E.out),
  T("oHalo", 0, 0.35, 380, 700, E.out),
  T("orb.alpha", 1, 0, 500, 800, E.out),
];

const unfoldTracks = (d: { pw: number; cw: number }, tailMs: number) => [
  T("w", BALL, 124, 0, 90, E.in),
  T("h", BALL, 124, 0, 90, E.in),
  T("w", 124, d.cw, 90, 700, E.card),
  T("h", 124, CARD_H, 90, 700, E.out),
  T("r", BALL / 2, 20, 90, 700, E.io),
  T("oGreen", 1, 0, 200, 560, E.out),
  T("oCard", 0, 1, 200, 560, E.out),
  T("oHalo", 0.35, 0, 300, 700, E.out),
  T("cHalo", 0.6, 0.22, 300, 700, E.out),
  T("hOp", 0, 1, 520, 840, E.out),
  T("dotS", 0, 1, 520, 840, E.spring),
  T("wp", 0, 1, 600, 600 + tailMs, E.lin),
  T("bloom", 1, 0.625, 700, 1200, E.io),
];

const launchReduced = [
  T("oInput", 1, 0, 0, 140, E.out),
  T("oPill", 1, 0, 0, 200, E.out),
  T("oGlow", 1, 0, 0, 200, E.out),
  T("oAur", 1, 0, 0, 200, E.out),
  T("oRing", 1, 0, 0, 200, E.out),
];

const assembleReduced = [
  T("orb.alpha", 0, 1, 0, 200, E.out),
  T("sOp", 0, 1, 0, 200, E.out),
  T("cHalo", 0, 0.6, 0, 200, E.out),
];

const resolveReduced = [
  T("orb.sweep", 0, 1, 0, 250, E.io),
  T("orb.floor", 0, 0.95, 0, 250, E.out),
];

const condenseReduced = [
  T("oGreen", 0, 1, 0, 250, E.out),
  T("orb.alpha", 1, 0, 0, 250, E.out),
  T("sOp", 1, 0, 0, 250, E.out),
];

const cardOut = [T("oGreen", 1, 0, 0, 120, E.out)];

const rCardIn = (ms: number) => [
  T("oCard", 0, 1, 0, 250, E.out),
  T("hOp", 0, 1, 0, 250, E.out),
  T("wp", 0, 1, 0, ms, E.lin),
  T("bloom", 1, 0.625, 0, 250, E.out),
];

const fadeChannels = [
  "oGlow",
  "oAur",
  "oPill",
  "oBall",
  "oGreen",
  "oCard",
  "oRing",
  "oInput",
  "oHalo",
  "sOp",
  "orb.alpha",
  "trail",
];

const DEFAULTS: Record<string, number> = {
  h: RING_R,
  r: 999,
  oGlow: 1,
  oHalo: 0,
  oPill: 1,
  oBall: 0,
  oGreen: 0,
  oCard: 0,
  oRing: 1,
  oInput: 1,
  inScale: 1,
  oAur: 1,
  gs: 0.55,
  cs: 1,
  hOp: 0,
  dotS: 0,
  bloom: 1,
  u: 0,
  yOff: 0,
  trail: 0,
  pulse: -1,
  sOp: 0,
  sTy: 6,
  cHalo: 0,
  wp: 0,
  "orb.k": 0,
  "orb.alpha": 0,
  "orb.spin": 0,
  "orb.pop": 1,
  "orb.sweep": 0,
  "orb.vortex": 0,
  "orb.gain": 1,
  "orb.floor": 0,
  "orb.rad": 0,
};

/* ------------------------------------------------------------------ */
/* Async helpers                                                       */
/* ------------------------------------------------------------------ */

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) {
    resolve();
    return promise;
  }
  let timer = 0;
  const onAbort = () => {
    window.clearTimeout(timer);
    resolve();
  };
  timer = window.setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, Math.max(0, ms));
  signal.addEventListener("abort", onAbort, { once: true });
  return promise;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  const { promise: result, resolve } = Promise.withResolvers<T | undefined>();
  if (signal.aborted) {
    resolve(undefined);
    return result;
  }
  const onAbort = () => resolve(undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  promise.then(
    (v) => {
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    },
    () => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    },
  );
  return result;
}

/* ------------------------------------------------------------------ */
/* Particle sphere + color table                                       */
/* ------------------------------------------------------------------ */

const RINGS = 16;

const SPHERE = (() => {
  const rand = mulberry32(7);
  const pts: { x: number; y: number; z: number; u: number; seed: number }[] = [];
  for (let i = 0; i < RINGS; i++) {
    const y = 1 - ((i + 0.5) / RINGS) * 2;
    const r = Math.sqrt(1 - y * y);
    const count = Math.max(4, Math.round(30 * r));
    for (let j = 0; j < count; j++) {
      const a = (j / count) * TAU + i * 0.35;
      pts.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        u: (1 - y) / 2,
        seed: rand() * 6.283,
      });
    }
  }
  return pts;
})();

const P = SPHERE.length;
const PX = Float32Array.from(SPHERE, (p) => p.x);
const PY = Float32Array.from(SPHERE, (p) => p.y);
const PZ = Float32Array.from(SPHERE, (p) => p.z);
const PU = Float32Array.from(SPHERE, (p) => p.u);
const PS = Float32Array.from(SPHERE, (p) => p.seed);

const GLOW_STOPS = 24;
const ALPHA_STOPS = 48;

const COLORS = (() => {
  const stops: string[] = [];
  for (let i = 0; i <= GLOW_STOPS; i++) {
    const t = i / GLOW_STOPS;
    const r = Math.round(lerp(235, 52, t));
    const g = Math.round(lerp(235, 211, t));
    const b = Math.round(lerp(235, 153, t));
    for (let j = 0; j <= ALPHA_STOPS; j++) {
      stops.push(`rgba(${r},${g},${b},${(j / ALPHA_STOPS).toFixed(3)})`);
    }
  }
  return stops;
})();

const ORB_CHANNELS = [
  "k",
  "alpha",
  "spin",
  "sweep",
  "pop",
  "vortex",
  "gain",
  "floor",
  "rad",
] as const;

/* ------------------------------------------------------------------ */
/* Canvas orb engine                                                   */
/* ------------------------------------------------------------------ */

interface OrbState {
  k: number;
  alpha: number;
  spin: number;
  rot: number;
  sweep: number;
  pop: number;
  vortex: number;
  gain: number;
  floor: number;
  rad: number;
  prog: number;
}

interface Orb {
  state: OrbState;
  ensure: () => void;
  reset: () => void;
  destroy: () => void;
}

function createOrb(
  canvas: HTMLCanvasElement,
  getSpeed: () => number,
  isReduced: () => boolean,
): Orb {
  const state: OrbState = {
    k: 0,
    alpha: 0,
    spin: 0,
    rot: 0,
    sweep: 0,
    pop: 1,
    vortex: 0,
    gain: 1,
    floor: 0,
    rad: 0,
    prog: 0,
  };
  const ctx = canvas.getContext("2d");
  const energy = new Float32Array(P);
  const cx = new Float32Array(P);
  const cy = new Float32Array(P);
  const cr = new Float32Array(P);
  const calpha = new Float32Array(P);
  const ccolor = new Int16Array(P);
  const progLayer = [1, 0, 0, 0];
  let time = 0;
  let rafId = 0;
  let last = 0;
  let dead = false;

  const reset = () => {
    state.k = 0;
    state.alpha = 0;
    state.spin = 0;
    state.rot = 0;
    state.sweep = 0;
    state.pop = 1;
    state.vortex = 0;
    state.gain = 1;
    state.floor = 0;
    state.rad = 0;
    state.prog = 0;
    energy.fill(0);
    progLayer[0] = 1;
    progLayer[1] = 0;
    progLayer[2] = 0;
    progLayer[3] = 0;
    time = isReduced() ? 1.2 : 0;
  };

  reset();

  if (!ctx) {
    return { state, ensure() {}, reset, destroy() {} };
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(ORB * dpr);
  canvas.height = Math.round(ORB * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const GAIN = 0.6;
  const TILT_COS = Math.cos(0.35);
  const TILT_SIN = Math.sin(0.35);
  const half = ORB / 2;

  const draw = (dt: number) => {
    ctx.clearRect(0, 0, ORB, ORB);
    time += dt;
    state.rot += state.spin * dt;

    const rot = state.rot + state.vortex;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const snap = dt / 0.35;

    for (let layer = 0; layer < 4; layer++) {
      const target = (layer === state.prog ? 1 : 0) - (progLayer[layer] ?? 0);
      const next =
        Math.abs(target) <= snap ? target : target > 0 ? snap : -snap;
      progLayer[layer] = (progLayer[layer] ?? 0) + next;
    }

    const decay = Math.exp(-dt / 0.5);
    const sparkA = (time * 300) % P;
    const sparkB = (time * 480) % P;
    const driftA = time * 0.8;
    const tiltX = Math.sin(time * 0.5) * 0.9;
    const ax1 = Math.cos(tiltX) * Math.cos(driftA);
    const ax2 = Math.sin(tiltX);
    const ax3 = Math.cos(tiltX) * Math.sin(driftA);
    const drift2 = time * 0.55 + 2.1;
    const tilt2 = Math.cos(time * 0.42) * 0.9;
    const bx1 = Math.cos(tilt2) * Math.cos(drift2);
    const bx2 = Math.sin(tilt2);
    const bx3 = Math.cos(tilt2) * Math.sin(drift2);
    const waveY = Math.sin(time * 2.2);
    const vortexTwist = state.vortex * 1.5;

    for (let i = 0; i < P; i++) {
      const x = PX[i] ?? 0;
      const y = PY[i] ?? 0;
      const z = PZ[i] ?? 0;
      const u = PU[i] ?? 0;
      let brightness = 0;

      if ((progLayer[0] ?? 0) > 0.001) {
        let dist = Math.abs(i - sparkA);
        if (dist > P - dist) dist = P - dist;
        const b = Math.max(0, 1 - dist / 16);
        brightness = Math.max(brightness, b * b * (progLayer[0] ?? 0));
      }
      if ((progLayer[1] ?? 0) > 0.001) {
        const p1 = Math.max(0, (x * ax1 + y * ax2 + z * ax3 - 0.72) / 0.28);
        const p2 = Math.max(0, (x * bx1 + y * bx2 + z * bx3 - 0.72) / 0.28);
        const m = Math.max(p1, p2);
        brightness = Math.max(brightness, m * m * (progLayer[1] ?? 0));
      }
      if ((progLayer[2] ?? 0) > 0.001) {
        const d = y - waveY;
        const b = Math.max(0, 1 - (d * d) / 0.02);
        brightness = Math.max(brightness, b * b * (progLayer[2] ?? 0));
      }
      if ((progLayer[3] ?? 0) > 0.001) {
        let dist = Math.abs(i - sparkB);
        if (dist > P - dist) dist = P - dist;
        const b = Math.max(0, 1 - dist / 22);
        brightness = Math.max(brightness, b * b * (progLayer[3] ?? 0));
      }

      const e = Math.max((energy[i] ?? 0) * decay, brightness * state.gain);
      energy[i] = e;

      const mask = clamp01(state.k * (1 + GAIN) - GAIN * u);
      if (mask <= 0.001) {
        ccolor[i] = -1;
        continue;
      }

      const em = E.out(mask);
      const pop = em * state.pop;
      const rx = x * cosR + z * sinR;
      const rz = -x * sinR + z * cosR;
      const ty = y * TILT_COS - rz * TILT_SIN;
      const ty2 = y * TILT_SIN + rz * TILT_COS;
      const persp = 2.8 / (2.8 - ty2);
      const h = (ty2 + 1) / 2;
      let kx = rx * RING_X * pop * persp;
      let ky = -ty * RING_X * pop * persp;

      if (vortexTwist > 0.001) {
        const ang = (1 - mask) * vortexTwist;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const ix = kx * c - ky * s;
        ky = kx * s + ky * c;
        kx = ix;
      }

      const sweepH = clamp01((state.sweep * 1.4 - u) / 0.4);
      let b =
        0.1 +
        0.035 * Math.sin((PS[i] ?? 0) + time * 1.6) * (1 - sweepH) +
        0.32 * h * h +
        0.75 * e * (1 - sweepH) +
        sweepH * (0.55 + 0.4 * h) +
        2 * sweepH * (1 - sweepH);
      b = Math.max(b, state.floor * (0.7 + 0.3 * h));
      if (b > 1) b = 1;
      b *= em * state.alpha;

      cx[i] = half + kx;
      cy[i] = half + ky;
      calpha[i] = h;
      cr[i] =
        (1.15 * (0.45 + 0.75 * h) * persp + 0.9 * e + sweepH * 0.25) *
        (1 + state.rad) *
        (0.4 + 0.6 * em);

      const alphaIdx = Math.round(b * ALPHA_STOPS);
      const glowIdx = Math.round(sweepH * GLOW_STOPS);
      ccolor[i] = alphaIdx <= 0 ? -1 : glowIdx * (ALPHA_STOPS + 1) + alphaIdx;
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < P; i++) {
        const ci = ccolor[i] ?? -1;
        const color = ci >= 0 ? COLORS[ci] : undefined;
        const alpha = calpha[i] ?? 0;
        if (color !== undefined && alpha >= 0.5 === (pass === 1)) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx[i] ?? 0, cy[i] ?? 0, cr[i] ?? 0, 0, TAU);
          ctx.fill();
        }
      }
    }
  };

  const frame = (ts: number) => {
    rafId = 0;
    if (dead) return;
    const dt = isReduced()
      ? 0
      : Math.max(0, Math.min(0.05, (ts - last) / 1000)) * getSpeed();
    last = ts;
    draw(dt);
    if (state.alpha > 0.002) rafId = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, ORB, ORB);
  };

  const ensure = () => {
    if (!rafId && !dead && state.alpha > 0.002) {
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  };

  const destroy = () => {
    dead = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  return { state, ensure, reset, destroy };
}

/* ------------------------------------------------------------------ */
/* Trail sampling                                                      */
/* ------------------------------------------------------------------ */

interface TrailPoint {
  t: number;
  x: number;
  y: number;
  d: number;
}

function sampleAt(history: TrailPoint[], time: number, out: TrailPoint) {
  const n = history.length;
  const copy = (p: TrailPoint) => {
    out.x = p.x;
    out.y = p.y;
    out.d = p.d;
  };
  const first = history[0];
  if (n === 0 || first === undefined) {
    out.x = 0;
    out.y = 0;
    out.d = 0;
    return;
  }
  if (time <= first.t) {
    copy(first);
    return;
  }
  for (let i = n - 1; i > 0; i--) {
    const a = history[i - 1];
    const b = history[i];
    if (a === undefined || b === undefined) break;
    if (time >= a.t) {
      if (time >= b.t) {
        copy(b);
        return;
      }
      const t = (time - a.t) / (b.t - a.t || 1);
      out.x = lerp(a.x, b.x, t);
      out.y = lerp(a.y, b.y, t);
      out.d = lerp(a.d, b.d, t);
      return;
    }
  }
  const last = history[n - 1];
  if (last !== undefined) copy(last);
}

/* ------------------------------------------------------------------ */
/* Timeline engine                                                     */
/* ------------------------------------------------------------------ */

interface RuntimeUI {
  setPhase: (phase: string) => void;
  swapLabel: (label: string) => void;
  resetLabel: () => void;
  setAnswer: (text: string) => void;
  clearInput: () => void;
  live: (message: string) => void;
  lock: (locked: boolean) => void;
  idleReady: () => void;
  focusAnswer: () => void;
}

interface RuntimeConfig {
  onSubmit: (prompt: string) => unknown;
  minThink: number;
}

interface RuntimeDeps {
  root: HTMLElement;
  mover: HTMLElement;
  actor: HTMLElement;
  form: HTMLFormElement;
  ghosts: HTMLElement[];
  canvas: HTMLCanvasElement;
  pulse: HTMLElement;
  status: HTMLElement;
  getBody: () => HTMLElement | null;
  getSpeed: () => number;
  isReduced: () => boolean;
  ui: RuntimeUI;
}

interface Runtime {
  start: (prompt: string, cfg: RuntimeConfig) => boolean;
  escape: () => void;
  reset: () => void;
  hard: () => void;
  home: () => void;
  busy: () => boolean;
  destroy: () => void;
}

const ABORT = Symbol("abort");

function createRuntime(deps: RuntimeDeps): Runtime {
  const { actor, mover, root, status, pulse, ghosts, form } = deps;
  const rootCtl = new AbortController();
  const geo = { pw: pillW(), cw: cardW(), H: homeDy(), dir: -1 };
  const orb = createOrb(deps.canvas, deps.getSpeed, deps.isReduced);
  const channels: Record<string, number> = {};
  const pending = new Set<string>();
  const setters: Record<string, ((v: number) => void) | undefined> = {};
  let runCtl: AbortController | null = null;
  let idleCtl: AbortController | null = null;
  let running = false;
  let transitioning = false;
  let runSeq = 0;
  let idleSeq = 0;
  let trailGain = 0;
  let ghostsVisible = false;
  let wordStagger = 45;
  let wordTail = 320;
  let lastX = 0;
  let lastY = 0;
  let lastW = PILL;
  const trail: TrailPoint[] = [];
  const trailPos: TrailPoint = { t: 0, x: 0, y: 0, d: 0 };

  const child = () => {
    const ctl = new AbortController();
    if (rootCtl.signal.aborted) ctl.abort();
    else rootCtl.signal.addEventListener("abort", () => ctl.abort(), { once: true });
    return ctl;
  };

  const renderTrail = () => {
    if (trailGain <= 0.001) {
      if (ghostsVisible) {
        ghosts.forEach((ghost) => {
          ghost.style.opacity = "0";
        });
        ghostsVisible = false;
      }
      return;
    }
    ghostsVisible = true;
    const now = performance.now();
    for (let i = 0; i < ghosts.length; i++) {
      sampleAt(trail, now - (i + 1) * 45, trailPos);
      const scale = (trailPos.d * (1 - 0.08 * (i + 1))) / 100;
      const ghost = ghosts[i];
      if (!ghost) continue;
      ghost.style.transform = `translate3d(${(trailPos.x - lastX).toFixed(2)}px,${(
        trailPos.y - lastY
      ).toFixed(2)}px,0) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
      ghost.style.opacity = (0.28 * Math.pow(1 - i / 6, 1.5) * trailGain).toFixed(3);
    }
  };

  const applyPath = () => {
    const u = channels.u ?? 0;
    const H = geo.H;
    lastX = bez(u, 0, geo.dir * 0.3 * H, 0);
    lastY = bez(u, H, 0.6 * H, 0) + (channels.yOff ?? 0);
    mover.style.transform = `translate3d(${lastX.toFixed(2)}px,${lastY.toFixed(2)}px,0)`;
    const now = performance.now();
    trail.push({ t: now, x: lastX, y: lastY, d: lastW });
    while (trail.length > 2 && trail[0] !== undefined && trail[0].t < now - 500) {
      trail.shift();
    }
    renderTrail();
  };

  const applyWords = (progress: number) => {
    const body = deps.getBody();
    if (!body) return;
    const words = body.querySelectorAll<HTMLElement>(".mo-w");
    const total = (words.length - 1) * wordStagger + wordTail;
    const elapsed = progress * total;
    const reduced = deps.isReduced();
    words.forEach((word, i) => {
      const p = E.out(clamp01((elapsed - i * wordStagger) / wordTail));
      word.style.opacity = fmt(p);
      const done = p >= 0.999 || reduced;
      word.style.transform = done ? "none" : `translateY(${fmt((1 - p) * 4)}px)`;
      word.style.filter = done ? "none" : `blur(${fmt((1 - p) * 4)}px)`;
    });
  };

  (
    [
      "oGlow",
      "oHalo",
      "oPill",
      "oBall",
      "oGreen",
      "oCard",
      "oRing",
      "oInput",
      "oAur",
      "gs",
      "cs",
      "hOp",
      "dotS",
      "bloom",
    ] as const
  ).forEach((ch) => {
    setters[ch] = (v: number) => actor.style.setProperty("--" + ch, fmt(v));
  });
  (["w", "h", "r"] as const).forEach((ch) => {
    setters[ch] = (v: number) => {
      actor.style.setProperty("--" + ch, fmt(v) + "px");
      if (ch === "w") lastW = v;
    };
  });
  setters.inScale = (v: number) => {
    actor.style.setProperty("--inScale", fmt(v));
    form.style.filter = v >= 0.999 ? "none" : `blur(${fmt((1 - v) * 15)}px)`;
  };
  setters.sOp = (v: number) => status.style.setProperty("--sOp", fmt(v));
  setters.sTy = (v: number) => status.style.setProperty("--sTy", fmt(v));
  setters.cHalo = (v: number) => root.style.setProperty("--oCenter", fmt(v));
  setters.u = () => applyPath();
  setters.yOff = () => applyPath();
  setters.trail = (v: number) => {
    trailGain = v;
    renderTrail();
  };
  setters.pulse = (v: number) => {
    if (v < 0) {
      pulse.style.opacity = "0";
      return;
    }
    pulse.style.opacity = fmt(0.5 * (1 - v));
    pulse.style.transform = `scale(${fmt(1 + v)})`;
  };
  setters.wp = applyWords;
  ORB_CHANNELS.forEach((ch) => {
    setters["orb." + ch] = (v: number) => {
      orb.state[ch] = v;
      if (ch === "alpha") orb.ensure();
    };
  });

  const set = (ch: string, v: number) => {
    channels[ch] = v;
    pending.add(ch);
  };
  const flush = () => {
    pending.forEach((ch) => {
      setters[ch]?.(channels[ch] ?? 0);
    });
    pending.clear();
  };
  const setNow = (ch: string, v: number) => {
    channels[ch] = v;
    setters[ch]?.(v);
  };
  const resetChannels = () => {
    setNow("w", geo.pw);
    for (const ch of Object.keys(DEFAULTS)) setNow(ch, DEFAULTS[ch] ?? 0);
  };

  const play = (tracks: Track[], signal: AbortSignal) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    if (signal.aborted) return promise;
    const end = tracks.reduce((m, t) => Math.max(m, t.t1), 0);
    const done = new Set<string>();
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const onAbort = () => {
      cancelAnimationFrame(raf);
      resolve();
    };
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const step = (now: number) => {
      const dt = Math.max(0, Math.min(100, now - last));
      last = now;
      elapsed += dt * deps.getSpeed();
      for (const track of tracks) {
        if (done.has(track.ch) || elapsed < track.t0) continue;
        const p = Math.min(1, (elapsed - track.t0) / Math.max(1, track.t1 - track.t0));
        set(track.ch, track.from + (track.to - track.from) * (track.ease ?? E.io)(p));
        if (p === 1) done.add(track.ch);
      }
      flush();
      if (elapsed >= end) finish();
      else raf = requestAnimationFrame(step);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    raf = requestAnimationFrame(step);
    return promise;
  };

  const labelLoop = async (signal: AbortSignal, stop: { stop: boolean }) => {
    let i = 0;
    for (;;) {
      await sleep(1150 / deps.getSpeed(), signal);
      if (signal.aborted || stop.stop) return;
      i = (i + 1) % dl.labels.length;
      const label = dl.labels[i];
      if (label !== undefined) {
        orb.state.prog = i % 4;
        deps.ui.swapLabel(label);
      }
    }
  };

  const run = async (prompt: string, signal: AbortSignal, cfg: RuntimeConfig) => {
    const reduced = deps.isReduced();
    const go = async (tracks: Track[]) => {
      await play(tracks, signal);
      if (signal.aborted) throw ABORT;
    };
    try {
      deps.ui.setPhase("launch");
      trail.length = 0;
      if (reduced) {
        await go(launchReduced);
        setNow("u", 1);
        setNow("w", BALL);
        setNow("h", BALL);
        setNow("r", BALL / 2);
        setNow("sTy", 0);
        setNow("orb.k", 1);
        setNow("orb.spin", 0);
        deps.ui.setPhase("assemble");
        await go(assembleReduced);
      } else {
        await go(launchTracks(geo));
        setNow("r", BALL / 2);
        deps.ui.setPhase("assemble");
        await go(assembleTracks);
      }
      deps.ui.setPhase("think");
      deps.ui.live(dl.labels[0]);
      const stop = { stop: false };
      labelLoop(signal, stop);
      const started = performance.now();
      const result = Promise.resolve()
        .then(() => cfg.onSubmit(prompt))
        .then(
          (text) => (typeof text === "string" && text.trim() ? text : dl.answerBody),
          () => dl.answerBody,
        );
      const answer = await abortable(result, signal);
      if (signal.aborted) throw ABORT;
      const finalText = answer ?? dl.answerBody;
      await sleep(cfg.minThink / deps.getSpeed() - (performance.now() - started), signal);
      stop.stop = true;
      if (signal.aborted) throw ABORT;
      const words = finalText.split(/\s+/).filter(Boolean);
      const count = Math.max(1, words.length);
      if (!reduced) {
        deps.ui.setPhase("resolve");
        deps.ui.swapLabel(dl.done);
        await go(resolveTracks);
        deps.ui.setPhase("condense");
        await go(condenseTracks);
        deps.ui.setPhase("unfold");
        wordTail = 320;
        wordStagger = count > 1 ? Math.min(45, 280 / (count - 1)) : 0;
        deps.ui.setAnswer(finalText);
        await go(unfoldTracks(geo, (count - 1) * wordStagger + wordTail));
      } else {
        deps.ui.setPhase("resolve");
        deps.ui.swapLabel(dl.done);
        await go(resolveReduced);
        await sleep(350 / deps.getSpeed(), signal);
        if (signal.aborted) throw ABORT;
        deps.ui.setPhase("condense");
        setNow("gs", 1);
        await go(condenseReduced);
        deps.ui.setPhase("unfold");
        wordTail = 250;
        wordStagger = 0;
        deps.ui.setAnswer(finalText);
        await go(cardOut);
        setNow("w", geo.cw);
        setNow("h", CARD_H);
        setNow("r", 20);
        setNow("dotS", 1);
        await go(rCardIn(wordTail));
      }
      deps.ui.setPhase("answered");
      deps.ui.live("Answer ready: " + finalText);
      deps.ui.focusAnswer();
    } catch (err) {
      if (err === ABORT) return;
      hard();
    }
  };

  const toIdle = async (mode: "esc" | "reset") => {
    if (transitioning) return;
    transitioning = true;
    const seq = ++idleSeq;
    const ctl = child();
    idleCtl = ctl;
    const signal = ctl.signal;
    const fadeOut = mode === "reset" ? 240 : 200;
    const fadeIn = mode === "reset" ? 420 : 200;
    deps.ui.setPhase("reset");
    const tracks: Track[] = [T("cHalo", channels.cHalo ?? 0, 0, 0, fadeOut, E.out)];
    for (const ch of fadeChannels) {
      const v = channels[ch] ?? 0;
      if (v > 0.001) tracks.push(T(ch, v, 0, 0, fadeOut, E.out));
    }
    if (mode === "reset") tracks.push(T("cs", 1, 0.98, 0, fadeOut, E.out));
    await play(tracks, signal);
    if (signal.aborted || seq !== idleSeq) return;
    setNow("pulse", -1);
    deps.ui.setAnswer("");
    deps.ui.resetLabel();
    deps.ui.clearInput();
    orb.reset();
    trail.length = 0;
    geo.pw = pillW();
    geo.cw = cardW();
    geo.H = homeDy();
    resetChannels();
    const fadeOutChannels = ["oPill", "oInput", "oGlow", "oAur", "oRing"];
    fadeOutChannels.forEach((ch) => setNow(ch, 0));
    setNow("yOff", mode === "reset" ? 8 : 0);
    const fadeInTracks = fadeOutChannels.map((ch) => T(ch, 0, 1, 0, fadeIn, E.out));
    if (mode === "reset") fadeInTracks.push(T("yOff", 8, 0, 0, fadeIn, E.out));
    await play(fadeInTracks, signal);
    if (!(signal.aborted || seq !== idleSeq)) {
      resetChannels();
      runCtl = null;
      idleCtl = null;
      running = false;
      transitioning = false;
      deps.ui.lock(false);
      deps.ui.setPhase("idle");
      deps.ui.idleReady();
    }
  };

  const hard = () => {
    runSeq++;
    if (runCtl) runCtl.abort();
    runCtl = null;
    if (idleCtl) idleCtl.abort();
    idleCtl = null;
    orb.reset();
    trail.length = 0;
    deps.ui.setAnswer("");
    deps.ui.resetLabel();
    geo.pw = pillW();
    geo.cw = cardW();
    geo.H = homeDy();
    resetChannels();
    setNow("pulse", -1);
    running = false;
    transitioning = false;
    deps.ui.lock(false);
    deps.ui.setPhase("idle");
    deps.ui.idleReady();
  };

  resetChannels();

  return {
    start(prompt: string, cfg: RuntimeConfig) {
      if (running) return false;
      running = true;
      geo.pw = pillW();
      geo.cw = cardW();
      geo.H = homeDy();
      geo.dir = -geo.dir;
      orb.reset();
      setNow("u", 0);
      const ctl = child();
      runCtl = ctl;
      deps.ui.lock(true);
      run(prompt, ctl.signal, cfg);
      return true;
    },
    escape() {
      if (!running || transitioning) return;
      if (runCtl) runCtl.abort();
      toIdle("esc");
    },
    reset() {
      if (!running || transitioning) return;
      toIdle("reset");
    },
    hard,
    home() {
      if (running) return;
      geo.pw = pillW();
      geo.cw = cardW();
      geo.H = homeDy();
      setNow("w", geo.pw);
      setNow("u", 0);
    },
    busy: () => running,
    destroy() {
      rootCtl.abort();
      orb.destroy();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface MorphOrbProps {
  speed?: number;
  minThinkMs?: number;
  onSubmit?: (prompt: string) => unknown;
}

export default function MorphOrb(props: MorphOrbProps) {
  const [phase, setPhase] = useState("idle");
  const [input, setInput] = useState("");
  const [label, setLabel] = useState<{ cur: string; prev: string | null; n: number }>({
    cur: dl.labels[0],
    prev: null,
    n: 0,
  });
  const [answer, setAnswer] = useState("");
  const [speedMult, setSpeedMult] = useState(1);
  const [debug] = useState(
    () =>
      typeof window !== "undefined" &&
      /[?&]debug(?:[=&]|$)/.test(window.location.search),
  );

  const propsRef = useRef(props);

  const speedRef = useRef(1);
  useEffect(() => {
    propsRef.current = props;
    speedRef.current = Math.max(0.05, (props.speed ?? 1) * speedMult);
  });
  const phaseRef = useRef("idle");
  const reducedRef = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const actorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ghostRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timeouts = useRef<{ typing?: number; shake?: number; flash?: number }>({});
  const lastPromptRef = useRef("");
  const runtimeRef = useRef<Runtime | null>(null);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onMq = (e: MediaQueryListEvent) => {
      reducedRef.current = e.matches;
    };
    mq.addEventListener("change", onMq);

    const runtime = createRuntime({
      root: rootRef.current!,
      mover: moverRef.current!,
      actor: actorRef.current!,
      form: formRef.current!,
      ghosts: ghostRefs.current.filter((g): g is HTMLSpanElement => g !== null),
      canvas: canvasRef.current!,
      pulse: pulseRef.current!,
      status: statusRef.current!,
      getBody: () => bodyRef.current,
      getSpeed: () => speedRef.current,
      isReduced: () => reducedRef.current,
      ui: {
        setPhase: (p) => {
          phaseRef.current = p;
          setPhase(p);
        },
        swapLabel: (l) =>
          setLabel((cur) =>
            cur.cur === l ? cur : { cur: l, prev: cur.cur, n: cur.n + 1 },
          ),
        resetLabel: () =>
          setLabel((cur) => ({ cur: dl.labels[0], prev: null, n: cur.n + 1 })),
        setAnswer: (a) => setAnswer(a),
        clearInput: () => setInput(""),
        live: (m) => {
          if (liveRef.current) liveRef.current.textContent = m;
        },
        lock: (l) => formRef.current?.toggleAttribute("inert", l),
        idleReady: () => inputRef.current?.focus({ preventScroll: true }),
        focusAnswer: () => answerRef.current?.focus({ preventScroll: true }),
      },
    });
    runtimeRef.current = runtime;

    const onKey = (e: KeyboardEvent<HTMLInputElement> | globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current !== "idle" && phaseRef.current !== "reset") {
        e.preventDefault();
        runtime.escape();
      }
    };
    const onResize = () => {
      if (phaseRef.current === "idle" && !runtime.busy()) runtime.home();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    inputRef.current?.focus({ preventScroll: true });

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMq);
      window.clearTimeout(timeouts.current.typing);
      window.clearTimeout(timeouts.current.shake);
      window.clearTimeout(timeouts.current.flash);
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, []);

  const defaultSubmit = () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    window.setTimeout(() => resolve(dl.answerBody), 4600 / speedRef.current);
    return promise;
  };

  const makeCfg = (): RuntimeConfig => ({
    onSubmit: propsRef.current.onSubmit ?? defaultSubmit,
    minThink: propsRef.current.minThinkMs ?? 3450,
  });

  const shake = () => {
    const actor = actorRef.current;
    if (!actor) return;
    actor.removeAttribute("data-shake");
    void actor.offsetWidth;
    actor.setAttribute("data-shake", "");
    actor.setAttribute("data-flash", "");
    window.clearTimeout(timeouts.current.shake);
    window.clearTimeout(timeouts.current.flash);
    timeouts.current.shake = window.setTimeout(() => actor.removeAttribute("data-shake"), 260);
    timeouts.current.flash = window.setTimeout(() => actor.removeAttribute("data-flash"), 200);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    const actor = actorRef.current;
    if (actor) {
      actor.setAttribute("data-typing", "");
      window.clearTimeout(timeouts.current.typing);
      timeouts.current.typing = window.setTimeout(() => actor.removeAttribute("data-typing"), 300);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.shiftKey || e.nativeEvent.isComposing)) {
      e.preventDefault();
    }
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const rt = runtimeRef.current;
    if (!rt || rt.busy() || phaseRef.current !== "idle") return;
    const q = input.trim();
    if (!q) {
      shake();
      return;
    }
    lastPromptRef.current = q;
    rt.start(q, makeCfg());
  };

  const onReset = () => {
    if (phase === "answered") runtimeRef.current?.reset();
  };

  const replay = () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const q = lastPromptRef.current || "hello";
    lastPromptRef.current = q;
    rt.hard();
    setInput(q);
    window.requestAnimationFrame(() => {
      rt.start(q, makeCfg());
    });
  };

  const hasInput = input.trim().length > 0;
  const words = answer.split(/\s+/).filter(Boolean);

  const labelInner = (text: string) =>
    text === dl.done ? (
      <span className="mo-lab-done">{text}</span>
    ) : (
      <>
        <span className="mo-lab-t">{text}</span>
        <span className="mo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </>
    );

  return (
    <div className="mo-root" data-phase={phase} ref={rootRef}>
      <div className="mo-bg" aria-hidden="true" />
      <div className="mo-halo" aria-hidden="true" />
      <div className="mo-mover" ref={moverRef}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className="mo-trail"
            aria-hidden="true"
            ref={(el) => {
              ghostRefs.current[i] = el;
            }}
          />
        ))}
        <div className="mo-actor" ref={actorRef}>
          <div className="mo-underglow" aria-hidden="true" />
          <div className="mo-halo-green" aria-hidden="true" />
          <div className="mo-surface" aria-hidden="true">
            <div className="mo-aurora">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="mo-ball" aria-hidden="true" />
          <div className="mo-green" aria-hidden="true" />
          <div className="mo-card" aria-hidden="true" />
          <div className="mo-ring" aria-hidden="true" />
          <form className="mo-input" ref={formRef} onSubmit={onFormSubmit} autoComplete="off">
            <svg
              className="mo-spark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7L10 3.5z" />
              <path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
            </svg>
            <input
              ref={inputRef}
              className="mo-field"
              type="text"
              value={input}
              maxLength={200}
              placeholder={dl.placeholder}
              aria-label="Ask anything"
              spellCheck={false}
              onChange={onChange}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="mo-send" aria-label={dl.send} data-ready={hasInput ? "" : undefined}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5" />
                <path d="M5.5 11.5L12 5l6.5 6.5" />
              </svg>
            </button>
          </form>
          <canvas className="mo-orb" ref={canvasRef} aria-hidden="true" />
          <div className="mo-pulse" ref={pulseRef} aria-hidden="true" />
          <div className="mo-answer" ref={answerRef} tabIndex={-1} role="group" aria-label={dl.answerTitle}>
            <div className="mo-a-head">
              <i className="mo-a-dot" aria-hidden="true" />
              <span>{dl.answerTitle}</span>
            </div>
            <p className="mo-a-body" ref={bodyRef}>
              {words.map((w, i) => (
                <Fragment key={i}>
                  <span className="mo-w">{w}</span>{" "}
                </Fragment>
              ))}
            </p>
          </div>
        </div>
      </div>
      <div className="mo-status" ref={statusRef} aria-hidden="true">
        {label.prev !== null && (
          <span className="mo-lab mo-out" key={"p" + label.n}>
            {labelInner(label.prev)}
          </span>
        )}
        <span className="mo-lab mo-in" key={"c" + label.n}>
          {labelInner(label.cur)}
        </span>
      </div>
      <button type="button" className="mo-reset" onClick={onReset}>
        {dl.reset}
      </button>
      <div className="mo-live" ref={liveRef} role="status" aria-live="polite" />
      {debug && (
        <div className="mo-debug">
          <span className="mo-chip">{phase}</span>
          <label>
            <span>{speedMult.toFixed(2)}×</span>
            <input
              type="range"
              min={0.25}
              max={2}
              step={0.05}
              value={speedMult}
              aria-label="Speed"
              onChange={(e) => setSpeedMult(parseFloat(e.target.value))}
            />
          </label>
          <button type="button" onClick={replay}>
            Replay
          </button>
        </div>
      )}
    </div>
  );
}
