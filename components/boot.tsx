/* PROJECT E.V. — boot sequence (frontend-owned).
   GSAP timeline, once per session. Reduced-motion or repeat visits skip it
   entirely. Cleans up its timeline on unmount. */
"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { motionAllowed } from "@/lib/motion";

const LINES = [
  "E.V. console initializing…",
  "Local vault mounted (IndexedDB)",
  "Telemetry bus attached",
  "Awaiting operator — Alfarez",
];

export default function Boot() {
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activate = () => {
      if (sessionStorage.getItem("ev-booted") === "1") return;
      if (!motionAllowed()) {
        sessionStorage.setItem("ev-booted", "1");
        return;
      }
      setVisible(true);
    };
    activate();
  }, []);

  useEffect(() => {
    if (!visible || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        onComplete: () => {
          sessionStorage.setItem("ev-booted", "1");
          setVisible(false);
        },
      });
      tl.from(".ev-boot-line", {
        opacity: 0,
        x: -14,
        duration: 0.4,
        stagger: 0.28,
        ease: "power2.out",
      })
        .from(
          ".ev-boot-bar",
          { scaleX: 0, transformOrigin: "left", duration: 1.1, ease: "power2.inOut" },
          "-=0.6",
        )
        .to(root.current, {
          opacity: 0,
          duration: 0.45,
          delay: 0.25,
          onComplete: () => {
            setVisible(false);
          },
        });
    }, root);
    return () => ctx.revert();
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="ev-boot" ref={root} aria-hidden="true">
      <div className="ev-boot-card">
        <p className="ev-label">E.V. // Boot Sequence</p>
        <div className="ev-boot-log">
          {LINES.map((line) => (
            <span key={line} className="ev-boot-line">
              ▸ {line}
            </span>
          ))}
        </div>
        <div className="ev-scan-track">
          <div className="ev-scan-fill ev-boot-bar" />
        </div>
      </div>
    </div>
  );
}
