"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface WebPreviewProps {
  sessionId: string;
  ports: number[];
}

const PROBE_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBES = 30; // give up after ~90s

/**
 * Preview origin for iframe isolation.
 * When set (e.g. "http://localhost:3001" in dev, "https://preview.anyterm.dev" in prod),
 * the iframe loads from a separate origin so it cannot access the parent's
 * sessionStorage (masterKey), cookies, or DOM.
 * Auth is via httpOnly cookie set by POST /preview-auth on the preview origin.
 */
const PREVIEW_ORIGIN = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN || "";
const PREVIEW_AUTH_REFRESH_MS = 4 * 60 * 1000; // refresh cookie every 4 min

export function WebPreview({ sessionId, ports }: WebPreviewProps) {
  const [activePort, setActivePort] = useState(ports[0]);
  const [path, setPath] = useState("/");
  const [inputPath, setInputPath] = useState("/");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false); // true once local server responds OK
  const [waiting, setWaiting] = useState(false); // true while probing
  const probeRef = useRef(0); // tracks current probe cycle to cancel stale ones
  const [probeGeneration, setProbeGeneration] = useState(0); // bump to restart probing
  const [previewAuthReady, setPreviewAuthReady] = useState(!PREVIEW_ORIGIN);

  // Set preview auth cookie on the preview origin (cross-origin only)
  useEffect(() => {
    if (!PREVIEW_ORIGIN) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const setPreviewCookie = async (): Promise<boolean> => {
      try {
        // Get session token from main app (httpOnly cookie → raw token)
        const tokenRes = await fetch("/api/ws-token");
        if (!tokenRes.ok || cancelled) return false;
        const { token } = await tokenRes.json();
        if (!token || cancelled) return false;

        // POST to preview origin to set the httpOnly preview cookie
        const res = await fetch(`${PREVIEW_ORIGIN}/preview-auth`, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok && !cancelled;
      } catch {
        return false;
      }
    };

    (async () => {
      const success = await setPreviewCookie();
      if (cancelled) return;
      if (success) {
        setPreviewAuthReady(true);
        refreshTimer = setInterval(() => {
          setPreviewCookie();
        }, PREVIEW_AUTH_REFRESH_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, []);

  const buildUrl = useCallback(
    (p: string) => {
      // Auth is via cookie — no token in the URL
      return PREVIEW_ORIGIN
        ? `${PREVIEW_ORIGIN}/tunnel/${sessionId}/${activePort}${p}`
        : `/tunnel/${sessionId}/${activePort}${p}`;
    },
    [sessionId, activePort],
  );

  const tunnelUrl = buildUrl(path);

  // Probe the tunnel until the local server is ready
  useEffect(() => {
    // Wait for preview auth cookie before probing on cross-origin
    if (PREVIEW_ORIGIN && !previewAuthReady) return;

    setReady(false);
    setWaiting(true);
    setError(false);
    const cycle = ++probeRef.current;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async () => {
      if (cycle !== probeRef.current) return; // stale
      // Always probe via same-origin path (Next.js rewrite → Hono).
      // This avoids CORS issues and uses the main session cookie for auth.
      const url = `/tunnel/${sessionId}/${activePort}/`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (cycle !== probeRef.current) return;
        if (res.ok || (res.status >= 300 && res.status < 500)) {
          setReady(true);
          setWaiting(false);
          return;
        }
      } catch {
        // fetch error or timeout — keep probing
      }
      if (cycle !== probeRef.current) return;
      attempt++;
      if (attempt >= MAX_PROBES) {
        setWaiting(false);
        setError(true);
        return;
      }
      timer = setTimeout(probe, PROBE_INTERVAL_MS);
    };

    probe();
    return () => {
      probeRef.current++; // cancel
      if (timer !== null) clearTimeout(timer);
    };
  }, [sessionId, activePort, buildUrl, probeGeneration, previewAuthReady]);

  const navigate = useCallback((newPath: string) => {
    const normalized = newPath.startsWith("/") ? newPath : "/" + newPath;
    setPath(normalized);
    setInputPath(normalized);
    setLoading(true);
    setError(false);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = tunnelUrl;
    }
  }, [tunnelUrl]);

  const handlePortChange = useCallback((port: number) => {
    setActivePort(port);
    setPath("/");
    setInputPath("/");
    setLoading(true);
    setError(false);
  }, []);

  // When using a separate preview origin, allow-same-origin is safe because the
  // iframe's origin differs from the parent. Without a separate origin, we must
  // NOT use allow-same-origin as it would let the iframe access the parent's
  // sessionStorage (which holds the E2E encryption masterKey).
  const sandboxAttr = PREVIEW_ORIGIN
    ? "allow-scripts allow-same-origin allow-forms allow-popups"
    : "allow-scripts allow-forms allow-popups";

  return (
    <div className="flex h-full flex-col border-l border-zinc-800/60 bg-zinc-950">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3 py-1.5">
        {/* Port selector */}
        {ports.length > 1 && (
          <select
            value={activePort}
            onChange={(e) => handlePortChange(Number(e.target.value))}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
          >
            {ports.map((p) => (
              <option key={p} value={p}>
                :{p}
              </option>
            ))}
          </select>
        )}
        {ports.length === 1 && (
          <span className="text-xs text-zinc-500">:{activePort}</span>
        )}

        {/* URL bar */}
        <form
          className="flex flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(inputPath);
          }}
        >
          <input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            className="flex-1 rounded bg-zinc-800/50 px-2 py-1 font-code text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:bg-zinc-800"
            placeholder="/"
          />
        </form>

        {/* Refresh */}
        <button
          onClick={refresh}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Refresh"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path
              fillRule="evenodd"
              d="M3.56 2.56a.75.75 0 0 0-1.06 0l-2 2a.75.75 0 0 0 0 1.06l2 2a.75.75 0 1 0 1.06-1.06L2.12 5.12H8a4 4 0 0 1 0 8H5a.75.75 0 0 0 0 1.5h3a5.5 5.5 0 1 0 0-11H2.12l1.44-1.44a.75.75 0 0 0 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Open in new tab */}
        <a
          href={tunnelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Open in new tab"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M8.75 3.5a.75.75 0 0 0 .75-.75V.75a.75.75 0 0 0-1.5 0v2a.75.75 0 0 0 .75.75Z" />
            <path
              fillRule="evenodd"
              d="M2 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Zm2-.5h8a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      </div>

      {/* Content */}
      <div className="relative flex-1">
        {waiting && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            <div className="text-sm text-zinc-400">
              Waiting for localhost:{activePort}
            </div>
            <div className="text-xs text-zinc-600">
              The server hasn&apos;t started yet
            </div>
          </div>
        )}
        {loading && ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950">
            <div className="text-xs text-zinc-500">Loading...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950">
            <div className="text-sm text-zinc-400">
              Could not connect to localhost:{activePort}
            </div>
            <div className="text-xs text-zinc-600">
              Make sure the server is running
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { setError(false); setReady(true); setLoading(true); }}
                className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Load anyway
              </button>
              <button
                onClick={() => { setError(false); setProbeGeneration((g) => g + 1); }}
                className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {ready && (
          <iframe
            ref={iframeRef}
            src={tunnelUrl}
            className="h-full w-full border-0 bg-white"
            sandbox={sandboxAttr}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
