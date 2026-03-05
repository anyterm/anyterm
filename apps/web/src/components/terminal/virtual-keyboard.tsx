"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface VirtualKeyboardProps {
  onInput: (data: string) => void;
}

const ROW1 = [
  { label: "Esc", seq: "\x1b" },
  { label: "Tab", seq: "\t" },
  { label: "↑", seq: "\x1b[A" },
  { label: "^C", seq: "\x03" },
  { label: "^D", seq: "\x04" },
  { label: "^Z", seq: "\x1a" },
  { label: "^L", seq: "\x0c" },
];

const ROW2_KEYS = [
  { label: "←", seq: "\x1b[D" },
  { label: "↓", seq: "\x1b[B" },
  { label: "→", seq: "\x1b[C" },
  { label: "/", seq: "/" },
  { label: "⏎", seq: "\r" },
];

export function VirtualKeyboard({ onInput }: VirtualKeyboardProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleKey = useCallback(
    (seq: string) => {
      onInput(seq);
      setCtrlActive(false);
      setAltActive(false);
    },
    [onInput],
  );

  // Capture native keyboard input when a modifier is active
  useEffect(() => {
    if (!ctrlActive && !altActive) return;

    function onKeyDown(e: KeyboardEvent) {
      // Only intercept printable single-character keys
      if (e.key.length !== 1) return;

      e.preventDefault();
      e.stopPropagation();

      const char = e.key.toUpperCase();
      let seq: string;

      if (ctrlActive) {
        // Ctrl+key: character code - 64
        seq = String.fromCharCode(char.charCodeAt(0) - 64);
      } else {
        // Alt+key: ESC prefix
        seq = "\x1b" + e.key;
      }

      onInput(seq);
      setCtrlActive(false);
      setAltActive(false);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [ctrlActive, altActive, onInput]);

  const btnBase =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2 py-2 text-xs font-mono text-zinc-300 active:bg-zinc-700 select-none transition-colors";
  const btnActive =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-green-500/40 bg-green-500/20 px-2 py-2 text-xs font-mono text-green-400 active:bg-green-500/30 select-none transition-colors";

  return (
    <div
      ref={wrapperRef}
      className="shrink-0 border-t border-zinc-800/60 bg-zinc-900/80 px-2 py-2"
    >
      {/* Row 1 */}
      <div className="mb-1.5 flex gap-1.5 justify-center">
        {ROW1.map((key) => (
          <button
            key={key.label}
            type="button"
            className={btnBase}
            onPointerDown={(e) => {
              e.preventDefault();
              handleKey(key.seq);
            }}
          >
            {key.label}
          </button>
        ))}
      </div>
      {/* Row 2: Ctrl, Alt (sticky), then regular keys */}
      <div className="flex gap-1.5 justify-center">
        <button
          type="button"
          className={ctrlActive ? btnActive : btnBase}
          onPointerDown={(e) => {
            e.preventDefault();
            setCtrlActive((p) => !p);
            setAltActive(false);
          }}
        >
          Ctrl
        </button>
        <button
          type="button"
          className={altActive ? btnActive : btnBase}
          onPointerDown={(e) => {
            e.preventDefault();
            setAltActive((p) => !p);
            setCtrlActive(false);
          }}
        >
          Alt
        </button>
        {ROW2_KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className={key.label === "⏎" ? btnBase + " flex-1" : btnBase}
            onPointerDown={(e) => {
              e.preventDefault();
              handleKey(key.seq);
            }}
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}
