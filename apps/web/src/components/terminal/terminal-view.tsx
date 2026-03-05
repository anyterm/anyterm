"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { KeyUnlockModal } from "./key-unlock-modal";
import { WebPreview } from "./web-preview";
import { VirtualKeyboard } from "./virtual-keyboard";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY, ORG_KEYS_QUERY } from "@/lib/graphql-queries";
import type { TerminalSessionMeta } from "@anyterm/utils/types";
import {
  fromBase64,
  decryptPrivateKey,
  decryptSessionKey,
  openMessage,
} from "@anyterm/utils/crypto";

const XTerminal = dynamic(() => import("./x-terminal"), { ssr: false });

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200];
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

interface TerminalViewProps {
  session: TerminalSessionMeta;
  onSessionEnded?: (sessionId: string) => void;
  onNotification?: (sessionId: string, title: string, body: string) => void;
  onCliPresenceChange?: (sessionId: string, connected: boolean) => void;
}

export default function TerminalView({ session, onSessionEnded, onNotification, onCliPresenceChange }: TerminalViewProps) {
  const [sessionKey, setSessionKey] = useState<Uint8Array | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [error, setError] = useState("");

  // Zoom state: null = auto-fit, number = user override percentage
  const [zoom, setZoom] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showPreview, setShowPreview] = useState(!!session.forwardedPorts);
  const [mobileActivePanel, setMobileActivePanel] = useState<"terminal" | "preview">("terminal");
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [cliConnected, setCliConnected] = useState<boolean | null>(null); // null = unknown (waiting for server)
  const [sessionEnded, setSessionEnded] = useState(false);
  const inputRef = useRef<((data: string) => void) | null>(null);

  // Parse forwarded ports (use parseInt to reject hex/scientific notation)
  const forwardedPorts = session.forwardedPorts
    ? session.forwardedPorts
        .split(",")
        .map((p) => parseInt(p.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535)
    : [];

  useEffect(() => {
    unlockSession();
  }, [session.id]);

  // Load persisted zoom, expanded, and keyboard state
  useEffect(() => {
    const stored = localStorage.getItem("anyterm_zoom");
    if (stored) setZoom(Number(stored));
    if (localStorage.getItem("anyterm_expanded") === "true") setExpanded(true);
    if (localStorage.getItem("anyterm_keyboard") === "true") setShowKeyboard(true);
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((prev) => {
      const current = prev ?? 100;
      const next = ZOOM_STEPS.find((s) => s > current) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
      localStorage.setItem("anyterm_zoom", String(next));
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => {
      const current = prev ?? 100;
      const next = [...ZOOM_STEPS].reverse().find((s) => s < current) ?? ZOOM_STEPS[0];
      localStorage.setItem("anyterm_zoom", String(next));
      return next;
    });
  }, []);

  const setZoomTo = useCallback((value: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
    setZoom(clamped);
    localStorage.setItem("anyterm_zoom", String(clamped));
  }, []);

  const zoomReset = useCallback(() => {
    setZoom(null);
    localStorage.removeItem("anyterm_zoom");
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) localStorage.setItem("anyterm_expanded", "true");
      else localStorage.removeItem("anyterm_expanded");
      return next;
    });
  }, []);

  const toggleKeyboard = useCallback(() => {
    setShowKeyboard((prev) => {
      const next = !prev;
      if (next) localStorage.setItem("anyterm_keyboard", "true");
      else localStorage.removeItem("anyterm_keyboard");
      return next;
    });
  }, []);

  // Pinch-to-zoom gesture on the terminal area
  const termAreaRef = useRef<HTMLDivElement>(null);
  const zoomValRef = useRef(zoom);
  zoomValRef.current = zoom;

  useEffect(() => {
    const el = termAreaRef.current;
    if (!el) return;

    let startDist = 0;
    let startZoom = 100;

    function getDistance(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        startDist = getDistance(e.touches[0], e.touches[1]);
        startZoom = zoomValRef.current ?? 100;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getDistance(e.touches[0], e.touches[1]);
        const scale = dist / startDist;
        setZoomTo(Math.round(startZoom * scale));
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [setZoomTo]);

  // Keyboard shortcuts: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, zoomReset]);

  async function unlockSession(masterKeyOverride?: Uint8Array) {
    try {
      // Get masterKey from sessionStorage or override
      let masterKey = masterKeyOverride;
      if (!masterKey) {
        const stored = sessionStorage.getItem("anyterm_master_key");
        if (!stored) {
          setNeedsUnlock(true);
          return;
        }
        masterKey = fromBase64(stored);
      }

      // Fetch user keys
      const { data: keysData, error: keysError } = await urqlClient
        .query(USER_KEYS_QUERY, {})
        .toPromise();

      if (keysError) throw keysError;
      if (!keysData?.userKeys) throw new Error("Failed to fetch keys");

      // Decrypt user's privateKey
      const encPk = fromBase64(keysData.userKeys.encryptedPrivateKey);
      const userPublicKey = fromBase64(keysData.userKeys.publicKey);
      const userPrivateKey = await decryptPrivateKey(encPk, masterKey);

      const encSk = fromBase64(session.encryptedSessionKey);
      let sk: Uint8Array;

      // Try personal org path first (user's own keypair) — fast, no extra query
      try {
        sk = await decryptSessionKey(encSk, userPublicKey, userPrivateKey);
      } catch {
        // Decryption failed — session was likely sealed with an org key.
        // Fetch org keys and try the non-personal org path.
        const { data: orgKeysData } = await urqlClient
          .query(ORG_KEYS_QUERY, {})
          .toPromise();

        const orgKeys = orgKeysData?.orgKeys;
        if (!orgKeys?.orgPublicKey || !orgKeys?.encryptedOrgPrivateKey) {
          throw new Error("Org encryption keys not available. Waiting for key grant.");
        }
        const orgPrivateKey = openMessage(
          fromBase64(orgKeys.encryptedOrgPrivateKey),
          userPublicKey,
          userPrivateKey,
        );
        sk = await decryptSessionKey(encSk, fromBase64(orgKeys.orgPublicKey), orgPrivateKey);
      }

      setSessionKey(sk);
      setNeedsUnlock(false);
    } catch {
      setError("Failed to decrypt session. Wrong password?");
      setNeedsUnlock(true);
    }
  }

  if (needsUnlock) {
    return (
      <KeyUnlockModal
        error={error}
        onUnlock={(mk) => {
          setError("");
          unlockSession(mk);
        }}
      />
    );
  }

  if (!sessionKey) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-zinc-500">Decrypting session...</div>
      </div>
    );
  }

  return (
    <div ref={termAreaRef} className="flex h-full w-full flex-col bg-black p-2 touch-manipulation">
      <div className="mb-2 flex shrink-0 items-center justify-between px-2">
        <div className="flex items-center gap-2.5">
          <span className="font-code text-sm text-zinc-300">{session.name}</span>
          <span
            data-testid="session-status"
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              sessionEnded || session.status === "stopped"
                ? "bg-zinc-700/50 text-zinc-500"
                : session.status === "running" && cliConnected !== false
                  ? "bg-green-500/10 text-green-400"
                  : session.status === "running" || session.status === "disconnected"
                    ? "bg-yellow-500/10 text-yellow-400"
                    : "bg-zinc-700/50 text-zinc-500"
            }`}
          >
            {sessionEnded || session.status === "stopped"
              ? "stopped"
              : session.status === "running" && cliConnected !== false
                ? "running"
                : session.status === "running" || session.status === "disconnected"
                  ? "disconnected"
                  : session.status}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* View controls */}
          {forwardedPorts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowPreview((p) => {
                  if (!p) setMobileActivePanel("preview");
                  return !p;
                });
              }}
              className={`hidden rounded-lg px-2.5 py-1 text-xs font-medium transition-colors md:inline-block ${
                showPreview
                  ? "bg-green-500/15 text-green-400"
                  : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
              }`}
              title="Toggle web preview"
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={toggleExpanded}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              expanded
                ? "bg-green-500/15 text-green-400"
                : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
            }`}
            title={expanded ? "Fixed viewport" : "Show full history"}
          >
            {expanded ? "Full" : "Fixed"}
          </button>
          <button
            type="button"
            onClick={toggleKeyboard}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              showKeyboard
                ? "bg-green-500/15 text-green-400"
                : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
            }`}
            title="Toggle virtual keyboard"
          >
            Keys
          </button>

          {/* Zoom controls — separated by divider */}
          <div className="mx-1.5 h-4 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom !== null && zoom <= ZOOM_STEPS[0]}
            className="rounded-lg px-1.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
            title="Zoom out (Ctrl+-)"
          >
            −
          </button>
          <button
            type="button"
            onClick={zoomReset}
            className="min-w-[3rem] rounded-lg px-1.5 py-1 text-center text-xs text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
            title="Reset zoom (Ctrl+0)"
          >
            {zoom ? `${zoom}%` : "Auto"}
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom !== null && zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="rounded-lg px-1.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
            title="Zoom in (Ctrl++)"
          >
            +
          </button>
        </div>
      </div>
      {/* Mobile tab bar — visible only on small screens when ports are available */}
      {forwardedPorts.length > 0 && (
        <div className="flex shrink-0 border-b border-zinc-800/60 md:hidden">
          <button
            type="button"
            onClick={() => {
              setMobileActivePanel("terminal");
              setShowPreview(false);
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
              mobileActivePanel === "terminal"
                ? "border-b-2 border-green-400 text-green-400"
                : "text-zinc-500"
            }`}
          >
            Terminal
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileActivePanel("preview");
              setShowPreview(true);
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
              mobileActivePanel === "preview"
                ? "border-b-2 border-green-400 text-green-400"
                : "text-zinc-500"
            }`}
          >
            Preview
          </button>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 overflow-hidden ${showPreview ? "gap-0" : ""}`}>
        {/* Terminal panel: on mobile hide when preview is active, on md+ show as half or full */}
        <div className={`min-h-0 ${
          showPreview
            ? mobileActivePanel === "preview"
              ? "hidden md:block md:w-1/2"
              : "w-full md:w-1/2"
            : "w-full"
        }`}>
          <XTerminal
            session={session}
            sessionKey={sessionKey}
            isLive={session.status === "running" || session.status === "disconnected"}
            zoom={zoom}
            expanded={expanded}
            inputRef={inputRef}
            onCliPresenceChange={(connected) => {
              setCliConnected(connected);
              onCliPresenceChange?.(session.id, connected);
            }}
            onSessionEnded={() => {
              setSessionEnded(true);
              onSessionEnded?.(session.id);
            }}
            onNotification={(title, body) => onNotification?.(session.id, title, body)}
          />
        </div>
        {/* Preview panel: on mobile show full-width when active, on md+ show as half */}
        {showPreview && forwardedPorts.length > 0 && (
          <div className={`${
            mobileActivePanel === "preview"
              ? "w-full md:w-1/2"
              : "hidden md:block md:w-1/2"
          }`}>
            <WebPreview sessionId={session.id} ports={forwardedPorts} />
          </div>
        )}
      </div>
      {showKeyboard && cliConnected !== false && (
        <VirtualKeyboard onInput={(data) => inputRef.current?.(data)} />
      )}
    </div>
  );
}
