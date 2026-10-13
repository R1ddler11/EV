"use client";

// Settings layout authored from the task brief (the original
// 21st.dev component could not be located). Two card
// patterns remain — FeatureCard (capability) and GuideCard
// (documentation link, polymorphic via Slot).

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Card patterns                                                       */
/* ------------------------------------------------------------------ */

const cardVariants = cva("rounded-[10px] border p-4", {
  variants: {
    variant: {
      feature: "border-ev-line",
      guide:
        "border-ev-line transition-colors hover:border-ev-line2",
    },
  },
  defaultVariants: { variant: "feature" },
});

export interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional real destination, rendered as a small ghost button. */
  action?: { label: string; href: string };
  className?: string;
}

export function FeatureCard({ icon: Icon, title, description, action, className }: FeatureCardProps) {
  return (
    <div className={cn(cardVariants({ variant: "feature" }), className)}>
      <Icon className="size-4 text-ev-muted" aria-hidden="true" />
      <h3 className="text-[13.5px] font-semibold text-ev-ink">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-ev-muted">{description}</p>
      {action && (
        <a href={action.href} className="ev-btn ev-btn-sm ev-btn-ghost mt-2">
          {action.label}
        </a>
      )}
    </div>
  );
}

export interface GuideCardProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  icon: LucideIcon;
  title: string;
  description: string;
  asChild?: boolean;
  children?: React.ReactNode;
}

export function GuideCard({ icon: Icon, title, description, asChild, className, children, ...rest }: GuideCardProps) {
  const inner = (
    <>
      <Icon className="size-4 mt-0.5 flex-none text-ev-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ev-ink">
          {title}
          <ArrowUpRight
            className="size-3 text-ev-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ev-muted">
          {description}
        </span>
      </span>
    </>
  );

  if (asChild) {
    // Slot merges className onto its single child element. A bare <Link />
    // has no text content, so render the card content inside it — the child
    // must be a real element (never a Fragment) for the merge to land on.
    const child = (children ?? null) as React.ReactElement | null;
    return (
      <Slot className={cn(cardVariants({ variant: "guide" }), "group flex items-start gap-3", className)} {...rest}>
        {child && React.isValidElement(child)
          ? React.cloneElement(child, undefined, inner)
          : inner}
      </Slot>
    );
  }

  return (
    <a
      className={cn(cardVariants({ variant: "guide" }), "group flex items-start gap-3", className)}
      {...rest}
    >
      {inner}
    </a>
  );
}

