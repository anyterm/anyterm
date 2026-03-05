"use client";

import { useCallback, useRef } from "react";

export function useNotificationSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const playChime = useCallback(() => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;
      const now = ctx.currentTime;

      // Two-tone chime: C5 (523Hz) -> E5 (659Hz)
      const frequencies = [523.25, 659.25];
      const duration = 0.1;

      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.3;
        gain.gain.exponentialRampToValueAtTime(0.01, now + (i + 1) * duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * duration);
        osc.stop(now + (i + 1) * duration);
      });
    } catch {
      // Audio not available
    }
  }, []);

  return { playChime };
}
