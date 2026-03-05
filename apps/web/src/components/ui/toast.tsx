"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface Toast {
  id: string;
  message: string;
  variant: "success" | "info" | "error";
  dismissing?: boolean;
}

interface ToastContextValue {
  addToast: (opts: { message: string; variant?: Toast["variant"] }) => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Start dismiss animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)),
    );
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const addToast = useCallback(
    (opts: { message: string; variant?: Toast["variant"] }) => {
      const id = `toast-${++toastCounter}`;
      const toast: Toast = {
        id,
        message: opts.message,
        variant: opts.variant ?? "info",
      };
      setToasts((prev) => [...prev, toast]);

      // Auto-dismiss after 5s
      const timer = setTimeout(() => {
        dismiss(id);
        timers.current.delete(id);
      }, 5000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Clean up timers
  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const variantStyles: Record<Toast["variant"], string> = {
    success: "border-green-500/30 text-green-400",
    info: "border-blue-500/30 text-blue-400",
    error: "border-red-500/30 text-red-400",
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border border-zinc-700/60 bg-zinc-900 px-4 py-3 shadow-lg ${
              variantStyles[toast.variant]
            } ${toast.dismissing ? "animate-toast-out" : "animate-toast-in"}`}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm">{toast.message}</span>
              <button
                onClick={() => dismiss(toast.id)}
                className="ml-2 text-zinc-500 transition-colors hover:text-zinc-300"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
