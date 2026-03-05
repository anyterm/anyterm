"use client";

import { useCallback, useEffect, useRef } from "react";

export function useTabTitle() {
  const originalTitle = useRef("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Capture original title once on mount
  useEffect(() => {
    originalTitle.current = document.title;
  }, []);

  // Clean up flashing on visibility change
  useEffect(() => {
    function onFocus() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (originalTitle.current) {
        document.title = originalTitle.current;
      }
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const flashTitle = useCallback((message: string) => {
    if (!originalTitle.current) {
      originalTitle.current = document.title;
    }
    // Clear existing flash
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    let showMessage = true;
    document.title = message;
    intervalRef.current = setInterval(() => {
      showMessage = !showMessage;
      document.title = showMessage ? message : originalTitle.current;
    }, 1000);
  }, []);

  return { flashTitle };
}
