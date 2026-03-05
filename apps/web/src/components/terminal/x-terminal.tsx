"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { gql } from "urql";
import { encryptChunk, decryptChunk, fromBase64 } from "@anyterm/utils/crypto";
import { urqlClient } from "@/lib/urql";
import {
  decodeFrame,
  FrameType,
  createSubscribeFrame,
  createEncryptedInputFrame,
  createPongFrame,
  parseResizePayload,
} from "@anyterm/utils/protocol";
import { FRAME_VERSION } from "@anyterm/utils/types";
import type { TerminalSessionMeta } from "@anyterm/utils/types";

const CHUNKS_QUERY = gql`
  query ($sessionId: String!, $after: Int!, $limit: Int!) {
    chunks(sessionId: $sessionId, after: $after, limit: $limit) {
      seq data
    }
  }
`;

const BASE_FONT_SIZE = 14;
const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 28;
const MAX_EXPANDED_ROWS = 500;

interface XTerminalProps {
  session: TerminalSessionMeta;
  sessionKey: Uint8Array;
  isLive: boolean;
  zoom: number | null; // null = auto-fit, number = percentage (100 = base font size)
  expanded: boolean; // true = show full history, false = fixed viewport
  inputRef?: React.MutableRefObject<((data: string) => void) | null>;
  onCliPresenceChange?: (connected: boolean) => void;
  onSessionEnded?: () => void;
  onNotification?: (title: string, body: string) => void;
}

export default function XTerminal({
  session,
  sessionKey,
  isLive,
  zoom,
  expanded,
  inputRef,
  onCliPresenceChange,
  onSessionEnded,
  onNotification,
}: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<() => void>(() => {});

  // CLI's authoritative terminal size — used for font scaling
  const cliColsRef = useRef(session.cols || 80);
  const cliRowsRef = useRef(session.rows || 24);
  const zoomRef = useRef(zoom);
  const expandedRef = useRef(expanded);
  const cliConnectedRef = useRef(false);
  const disposedRef = useRef(false);
  const replayDoneRef = useRef(false);
  const wsChunkBufferRef = useRef<Uint8Array[]>([]);
  const onCliPresenceChangeRef = useRef(onCliPresenceChange);
  onCliPresenceChangeRef.current = onCliPresenceChange;
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;
    replayDoneRef.current = false;
    wsChunkBufferRef.current = [];

    // Create terminal at CLI's size
    const term = new Terminal({
      cursorBlink: true,
      cols: cliColsRef.current,
      rows: cliRowsRef.current,
      theme: {
        background: "#0f0f0f",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: BASE_FONT_SIZE,
      lineHeight: 1.2,
    });
    termRef.current = term;
    if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_E2E === "1") {
      (window as any).__xterm = term;
    }

    term.open(containerRef.current);

    // Make xterm element fill container (eliminates gap below canvas)
    if (term.element) {
      term.element.style.height = "100%";
    }

    // Try WebGL, fallback to canvas
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // canvas fallback is fine
    }

    // Intercept standard terminal notification sequences (BEL, OSC 9/99/777)
    term.onBell(() => {
      onNotificationRef.current?.("Terminal", "Bell");
    });

    term.parser.registerOscHandler(9, (data) => {
      onNotificationRef.current?.("Terminal", data);
      return true;
    });

    term.parser.registerOscHandler(99, (data) => {
      const semi = data.indexOf(";");
      const payload = semi >= 0 ? data.slice(semi + 1) : data;
      onNotificationRef.current?.("Terminal", payload || "Notification");
      return true;
    });

    term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(";");
      if (parts[0] === "notify") {
        onNotificationRef.current?.(parts[1] || "Terminal", parts[2] || "");
      }
      return true;
    });

    /**
     * Scale font so the CLI's cols/rows fit within the container.
     *
     * Works in fixed mode AND expanded mode when the alternate screen buffer
     * is active (TUI apps like Claude, vim, htop). The alt buffer has no
     * scrollback, so expanding is meaningless — auto-fit to fill the container.
     *
     * In expanded mode with the normal buffer, this function bails out —
     * the expanded handler manages rows/scroll for scrollback history.
     */
    function fitToCliSize() {
      const container = containerRef.current;
      if (!container || !term.element) return;

      // Expanded + normal buffer: let the expanded handler manage it
      if (expandedRef.current && term.buffer.active.type !== "alternate") return;

      const targetCols = cliColsRef.current;
      const targetRows = cliRowsRef.current;
      const currentZoom = zoomRef.current;

      let newFontSize: number;

      if (currentZoom !== null) {
        newFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * currentZoom / 100));
      } else {
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const cellWidth = term.element.querySelector(".xterm-char-measure-element")?.getBoundingClientRect().width
          || (term.options.fontSize! * 0.6);

        const currentFontSize = term.options.fontSize!;
        const charWidthRatio = cellWidth / currentFontSize;
        const fontForWidth = containerWidth / (targetCols * charWidthRatio);

        const cellHeight = cellWidth * (term.options.lineHeight! / 0.6) || currentFontSize * term.options.lineHeight!;
        const charHeightRatio = cellHeight / currentFontSize;
        const fontForHeight = containerHeight / (targetRows * charHeightRatio);

        const idealFontSize = Math.min(fontForWidth, fontForHeight);
        newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.floor(idealFontSize)));
      }

      // Fixed-mode CSS — also used for expanded+alt
      term.element.style.height = "100%";
      container.style.overflow = "hidden";

      if (newFontSize !== term.options.fontSize) {
        term.options.fontSize = newFontSize;
      }

      if (term.cols !== targetCols || term.rows !== targetRows) {
        term.resize(targetCols, targetRows);
      }
    }

    fitRef.current = fitToCliSize;
    fitToCliSize();

    // In expanded mode, handle content growth and buffer type transitions.
    // Alt buffer → delegate to fitToCliSize (auto-fit, no overflow).
    // Normal buffer → expand rows to show scrollback, follow-scroll.
    let expandTimer: ReturnType<typeof setTimeout> | null = null;
    const onWriteDisposable = term.onWriteParsed(() => {
      if (!expandedRef.current) return;
      if (expandTimer) return; // already scheduled
      expandTimer = setTimeout(() => {
        expandTimer = null;

        if (term.buffer.active.type === "alternate") {
          // Alt buffer: switch to fixed-mode layout (auto-fit font, no overflow)
          fitToCliSize();
          return;
        }

        // Normal buffer: expand rows, manage container scroll
        const container = containerRef.current;

        const fontSize = zoomRef.current !== null
          ? Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * zoomRef.current / 100))
          : BASE_FONT_SIZE;
        if (fontSize !== term.options.fontSize) {
          term.options.fontSize = fontSize;
        }

        // Ensure expanded CSS (may have been overridden by alt buffer path)
        if (term.element) term.element.style.height = "auto";
        if (container) {
          container.style.overflowY = "auto";
          container.style.overflowX = "hidden";
        }

        const targetRows = Math.min(term.buffer.active.length, MAX_EXPANDED_ROWS);
        if (term.rows !== targetRows) {
          term.resize(cliColsRef.current, targetRows);
        }

        // Follow-scroll: only auto-scroll if user is already at the bottom.
        // Prevents jumping away from content the user is reading.
        if (replayDoneRef.current && container) {
          const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;
          if (isAtBottom) {
            container.scrollTop = container.scrollHeight;
          }
        }
      }, 50);
    });

    // Initialize: connect WS first (buffers chunks), replay from DB, then flush buffer.
    // This eliminates the race where live WS chunks interleave with historical replay
    // and closes the 2s persistence gap (WS captures chunks not yet flushed to DB).
    (async () => {
      // Connect WS first to capture live chunks + presence during replay
      if (isLive) {
        connectWS(term, session, sessionKey, fitToCliSize);
      }

      // Replay historical chunks from DB
      await replayChunks(term, session.id, sessionKey, session);

      if (disposedRef.current) return;

      // Switch to live mode FIRST, then drain the buffer.
      // Any chunk arriving after this flag flip goes directly to xterm.write()
      // via the WS handler, so nothing can slip between flag and drain.
      replayDoneRef.current = true;
      const buffered = wsChunkBufferRef.current.splice(0);

      for (const payload of buffered) {
        try {
          const plaintext = await decryptChunk(payload, sessionKey);
          const text = new TextDecoder().decode(plaintext);
          term.write(text);
        } catch (err) {
          console.debug("[XTerminal] Skipping buffered WS chunk:", err);
        }
      }

      // After all queued writes are processed, apply the correct layout.
      // term.write() is async — the callback fires once all prior data has been parsed.
      term.write("", () => {
        if (disposedRef.current) return;
        // Scroll xterm's internal viewport to the active buffer
        term.scrollToBottom();
        // Re-apply layout — alt buffer may have been entered during replay.
        // For expanded+alt this applies auto-fit; for fixed mode it re-fits.
        fitToCliSize();
      });
    })();

    // Setup input forwarding for live sessions
    if (isLive) {
      const sendInput = async (data: string) => {
        if (!cliConnectedRef.current) return;
        const encoded = new TextEncoder().encode(data);
        const packed = await encryptChunk(encoded, sessionKey);
        const frame = createEncryptedInputFrame(session.id, packed);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(frame);
        }
      };

      term.onData(sendInput);

      if (inputRef) {
        inputRef.current = sendInput;
      }
    }

    // Browser viewport resize — re-apply layout
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitToCliSize();
        } catch {
          // Ignore fit errors (e.g. container collapsed to 0)
        }
      }, 100);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposedRef.current = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      if (expandTimer) clearTimeout(expandTimer);
      onWriteDisposable.dispose();
      resizeObserver.disconnect();
      wsRef.current?.close();
      if (inputRef) inputRef.current = null;
      term.dispose();
    };
  }, [session.id, sessionKey, isLive]);

  // Handle expanded mode toggle
  useEffect(() => {
    expandedRef.current = expanded;
    const term = termRef.current;
    const container = containerRef.current;
    if (!term || !container || !term.element) return;

    if (expanded) {
      if (term.buffer.active.type === "alternate") {
        // Alt buffer: use fixed-mode layout (auto-fit, no overflow)
        fitRef.current();
      } else {
        // Normal buffer: expanded layout with scrollable container
        const fontSize = zoomRef.current !== null
          ? Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * zoomRef.current / 100))
          : BASE_FONT_SIZE;
        term.options.fontSize = fontSize;

        const targetRows = Math.min(term.buffer.active.length, MAX_EXPANDED_ROWS);
        term.resize(cliColsRef.current, targetRows);

        term.element.style.height = "auto";
        container.style.overflowY = "auto";
        container.style.overflowX = "hidden";

        // Scroll to bottom when user manually toggles (not on initial load)
        if (replayDoneRef.current) {
          requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
          });
        }
      }
    } else {
      // Fixed mode
      fitRef.current();
    }
  }, [expanded]);

  // Re-apply font size when zoom prop changes
  useEffect(() => {
    zoomRef.current = zoom;
    const term = termRef.current;
    if (!term) return;

    // Expanded + normal buffer: just update font size (container scrolls)
    if (expandedRef.current && term.buffer.active.type !== "alternate") {
      const fontSize = zoom !== null
        ? Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * zoom / 100))
        : BASE_FONT_SIZE;
      if (fontSize !== term.options.fontSize) {
        term.options.fontSize = fontSize;
      }
      return;
    }

    // Fixed mode OR expanded+alt: full re-fit
    fitRef.current();
  }, [zoom]);

  async function fetchWsToken(): Promise<string | null> {
    try {
      const res = await fetch("/api/ws-token");
      if (!res.ok) return null;
      const data = await res.json();
      return data.token ?? null;
    } catch {
      return null;
    }
  }

  async function connectWS(
    term: Terminal,
    sess: TerminalSessionMeta,
    key: Uint8Array,
    onResize: () => void,
  ) {
    const wsBase =
      process.env.NEXT_PUBLIC_WS_URL ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const token = await fetchWsToken();
    if (!token) return;
    const ws = new WebSocket(`${wsBase}/ws`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    let handshakeOk = false;

    ws.onopen = () => {
      // Send JSON handshake as first message
      ws.send(JSON.stringify({
        version: FRAME_VERSION,
        token,
        source: "browser",
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = new Uint8Array(event.data);
        const frame = decodeFrame(data);

        // Handle handshake response
        if (!handshakeOk) {
          if (frame.type === FrameType.HANDSHAKE_OK) {
            handshakeOk = true;
            ws.send(createSubscribeFrame(sess.id));
            return;
          }
          if (frame.type === FrameType.ERROR) {
            const msg = new TextDecoder().decode(frame.payload);
            try {
              const err = JSON.parse(msg);
              if (err.code === "VERSION_MISMATCH") {
                term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
              }
            } catch {
              // ignore parse error
            }
            return;
          }
          return;
        }

        if (frame.type === FrameType.PING) {
          ws.send(createPongFrame());
        } else if (frame.type === FrameType.ENCRYPTED_CHUNK) {
          if (!replayDoneRef.current) {
            // Buffer chunks during historical replay to prevent interleaving
            wsChunkBufferRef.current.push(new Uint8Array(frame.payload));
          } else {
            const plaintext = await decryptChunk(frame.payload, key);
            const text = new TextDecoder().decode(plaintext);
            term.write(text);
          }
        } else if (frame.type === FrameType.RESIZE) {
          // CLI resized — update target size and re-scale font
          const { cols, rows } = parseResizePayload(frame.payload);
          cliColsRef.current = cols;
          cliRowsRef.current = rows;
          onResize();
        } else if (frame.type === FrameType.CLI_CONNECTED) {
          cliConnectedRef.current = true;
          onCliPresenceChangeRef.current?.(true);
        } else if (frame.type === FrameType.CLI_DISCONNECTED) {
          cliConnectedRef.current = false;
          onCliPresenceChangeRef.current?.(false);
        } else if (frame.type === FrameType.SESSION_ENDED) {
          term.write("\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n");
          onSessionEndedRef.current?.();
        }
      } catch (err) {
        console.debug("[XTerminal] Frame decode/handle error:", err);
      }
    };

    ws.onclose = (event) => {
      // Don't reconnect if auth/version failed or component unmounted
      if (isLive && event.code !== 4001 && event.code !== 4010 && !disposedRef.current) {
        setTimeout(() => {
          if (!disposedRef.current) connectWS(term, sess, key, onResize);
        }, 2000);
      }
    };
  }

  async function replayChunks(
    term: Terminal,
    sessionId: string,
    key: Uint8Array,
    sess: TerminalSessionMeta,
  ) {
    let after = 0;

    // If a snapshot exists, decrypt and apply it first (skips old chunks)
    if (sess.snapshotData && sess.snapshotSeq != null) {
      try {
        const packed = fromBase64(sess.snapshotData);
        const plaintext = await decryptChunk(packed, key);
        const text = new TextDecoder().decode(plaintext);
        term.write(text);
        after = sess.snapshotSeq;
      } catch {
        // Snapshot corrupted — fall back to full replay
        after = 0;
      }
    }

    // Then replay chunks after the snapshot (or from the beginning)
    let hasMore = true;
    while (hasMore) {
      let chunks: Array<{ seq: number; data: string }>;
      try {
        const { data, error } = await urqlClient
          .query(CHUNKS_QUERY, { sessionId, after, limit: 500 })
          .toPromise();
        if (error) throw error;
        chunks = data?.chunks ?? [];
      } catch {
        hasMore = false;
        break;
      }

      if (!chunks.length) {
        hasMore = false;
        break;
      }

      for (const chunk of chunks) {
        try {
          const packed = fromBase64(chunk.data);
          const plaintext = await decryptChunk(packed, key);
          const text = new TextDecoder().decode(plaintext);
          term.write(text);
        } catch (err) {
          console.debug("[XTerminal] Skipping corrupted chunk:", chunk.seq, err);
        }
        after = chunk.seq;
      }

      if (chunks.length < 500) hasMore = false;
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ backgroundColor: "#0f0f0f" }}
      className="h-full min-h-0 w-full overflow-hidden rounded-lg"
    />
  );
}
