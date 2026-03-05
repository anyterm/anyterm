"use client";

import { useEffect } from "react";
import { usePageVisibility } from "./use-page-visibility";
import { useTabTitle } from "./use-tab-title";
import { useNotificationSound } from "./use-notification-sound";
import { useToast } from "@/components/ui/toast";

export function useSessionNotifications() {
  const { isVisible } = usePageVisibility();
  const { flashTitle } = useTabTitle();
  const { playChime } = useNotificationSound();
  const { addToast } = useToast();

  // Request notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  function notify(title: string, body: string, variant: "success" | "info" = "info") {
    const message = body || title;

    // Always: toast
    addToast({ message, variant });

    // Always: flash tab title
    flashTitle(`${title} \u2014 anyterm`);

    // If tab hidden: chime + OS notification
    if (document.visibilityState === "hidden") {
      playChime();

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(title, { body, icon: "/favicon.ico" });
      }
    }
  }

  function notifySessionEnded(sessionName: string) {
    notify(`\u2713 ${sessionName} ended`, `Session '${sessionName}' has ended`, "success");
  }

  function notifyTerminal(sessionName: string, title: string, body: string) {
    notify(title || sessionName, body || "Notification from terminal", "info");
  }

  return { notifySessionEnded, notifyTerminal };
}
