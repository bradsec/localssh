import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ToastContext, type ShowToast, type ToastType } from "../toast.js";

type Toast = { id: number; message: string; type: ToastType; leaving: boolean };
const icons = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert };

function ToastCard({
  toast,
  order,
  dismiss,
  remove,
}: {
  toast: Toast;
  order: number;
  dismiss: (id: number) => void;
  remove: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.type === "error" ? 5000 : 3500);
  const Icon = icons[toast.type];

  useEffect(() => {
    if (toast.leaving) {
      const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
      const timer = window.setTimeout(() => remove(toast.id), delay);
      return () => window.clearTimeout(timer);
    }
    if (hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [dismiss, focused, hovered, remove, toast.id, toast.leaving]);

  return (
    <div
      className={`toast toast--${toast.type}${toast.leaving ? " toast--leaving" : ""}`}
      style={{ order }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Icon aria-hidden="true" />
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toolbarBottom, setToolbarBottom] = useState(56);
  const nextId = useRef(0);
  useEffect(() => {
    const toolbar = document.querySelector(".app-toolbar");
    if (!toolbar) return;
    const measure = () => setToolbarBottom(toolbar.getBoundingClientRect().bottom);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(toolbar);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const show = useCallback<ShowToast>((message, type = "info") => {
    setToasts((current) =>
      [...current, { id: ++nextId.current, message, type, leaving: false }].slice(-4),
    );
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
    );
  }, []);
  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" style={{ top: toolbarBottom + 12 }}>
        <div role="status" aria-live="polite" className="toast-region">
          {toasts.map((toast, index) =>
            toast.type === "error" ? null : (
              <ToastCard
                key={toast.id}
                toast={toast}
                order={index}
                dismiss={dismiss}
                remove={remove}
              />
            ),
          )}
        </div>
        <div aria-live="assertive" className="toast-region">
          {toasts.map((toast, index) =>
            toast.type !== "error" ? null : (
              <ToastCard
                key={toast.id}
                toast={toast}
                order={index}
                dismiss={dismiss}
                remove={remove}
              />
            ),
          )}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
