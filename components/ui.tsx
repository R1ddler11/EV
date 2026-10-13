/* Small shared UI atoms: section heading, status pill, confirm dialog. */
"use client";

import { useEffect, useRef } from "react";

export function SectionLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return <p className="ev-label" id={id}>{children}</p>;
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "mute";
  children: React.ReactNode;
}) {
  return <span className={`ev-pill ev-pill-${tone}`}>{children}</span>;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmText = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onCancel();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="ev-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className="ev-confirm" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="ev-confirm-actions">
          <button type="button" className="ev-btn ev-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`ev-btn ${danger ? "ev-btn-danger" : "ev-btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
