"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export type ActiveToast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  /** Show a toast (auto-dismisses after a few seconds). */
  toast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  item,
  onRemove,
}: {
  item: ActiveToast;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onRemove(item.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, onRemove]);

  const surface =
    item.variant === "success"
      ? "border-emerald-500/25 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/50 dark:text-emerald-50"
      : item.variant === "error"
        ? "border-red-500/25 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-50"
        : "border-black/[0.08] bg-white text-zinc-900 shadow-md dark:border-white/[0.12] dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <div
      className={`toast-surface pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${surface}`}
      role="status"
    >
      <p className="min-w-0 flex-1 text-sm font-medium leading-snug">
        {item.message}
      </p>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="-m-1 shrink-0 rounded-md p-1 text-current opacity-60 transition hover:opacity-100 focus-visible:outline focus-visible:ring-2 focus-visible:ring-zinc-400"
        aria-label="Dismiss notification"
      >
        <span aria-hidden className="text-lg leading-none">
          ×
        </span>
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
