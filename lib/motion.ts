/* PROJECT E.V. — motion helpers (frontend-owned).
   GSAP is reserved for: boot sequence, core activation, panel entrances,
   scan animation, voice transitions. Ambient motion stays in CSS.
   Every helper no-ops when the user prefers reduced motion. */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Lightweight check hook for components choosing CSS fallbacks. */
export function motionAllowed(override?: "system" | "reduce" | "full"): boolean {
  if (override === "reduce") return false;
  if (override === "full") return true;
  return !prefersReducedMotion();
}
