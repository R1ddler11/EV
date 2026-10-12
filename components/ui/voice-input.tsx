"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VoiceInputProps {
  className?: string;
  onStart?: () => void;
  onStop?: () => void;
}

export function VoiceInput({ className, onStart, onStop }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: number | undefined;
    if (recording) {
      onStart?.();
      interval = window.setInterval(() => setDuration((v) => v + 1), 1000);
    } else {
      onStop?.();
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const formatTime = (total: number) => {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const onClickHandler = () => {
    if (recording) {
      setRecording(false);
      setDuration(0);
    } else {
      setRecording(true);
    }
  };

  // Deterministic per-bar keyframes: pure in render, re-rolled on each
  // duration tick (the same cadence the original random re-roll had).
  const barHeights = (i: number) => [
    2,
    3 + (Math.sin(duration * 0.9 + i * 1.7) * 0.5 + 0.5) * 10,
    3 + (Math.sin(duration * 1.3 + i * 2.3 + 2) * 0.5 + 0.5) * 5,
    2,
  ];

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <motion.div
        className="flex p-2 border items-center justify-center rounded-full cursor-pointer"
        layout
        transition={{ layout: { duration: 0.4 } }}
        onClick={onClickHandler}
      >
        <div className="h-6 w-6 items-center justify-center flex">
          {recording ? (
            <motion.div
              className="w-4 h-4 bg-primary rounded-sm"
              animate={{ rotate: [0, 180, 360] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : (
            <Mic />
          )}
        </div>
        <AnimatePresence mode="wait">
          {recording && (
            <motion.div
              initial={{ opacity: 0, width: 0, marginLeft: 0 }}
              animate={{ opacity: 1, width: "auto", marginLeft: 8 }}
              exit={{ opacity: 0, width: 0, marginLeft: 0 }}
              transition={{ duration: 0.4 }}
              className="overflow-hidden flex gap-2 items-center justify-center"
            >
              <div className="flex gap-0.5 items-center justify-center">
                {Array.from({ length: 12 }, (_, i) => i).map((i) => (
                  <motion.div
                    key={i}
                    className="w-0.5 bg-primary rounded-full"
                    initial={{ height: 2 }}
                    animate={{ height: recording ? barHeights(i) : 2 }}
                    transition={{
                      duration: recording ? 1 : 0.3,
                      repeat: recording ? Infinity : 0,
                      delay: recording ? i * 0.05 : 0,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
              <div className="text-xs text-muted-foreground w-10 text-center">
                {formatTime(duration)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
