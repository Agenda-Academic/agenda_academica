"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Botões                                                              */
/* ------------------------------------------------------------------ */

export const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-700";

export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

export const iconButton =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50";

/* ------------------------------------------------------------------ */
/* Formulário                                                          */
/* ------------------------------------------------------------------ */

export function Field({
  children,
  className,
  hint,
  label,
}: {
  children: ReactNode;
  className?: string;
  hint?: string;
  label: string;
}) {
  return (
    <label className={cx("grid gap-1.5 text-sm font-semibold text-slate-700", className)}>
      <span className="flex items-baseline justify-between gap-2">
        {label}
        {hint ? <span className="text-xs font-normal text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export type ToastTone = "success" | "danger" | "info";

export type ToastItem = {
  id: number;
  tone: ToastTone;
  text: string;
};

const toastToneStyles: Record<ToastTone, { wrap: string; icon: LucideIcon; iconColor: string }> = {
  success: {
    wrap: "border-emerald-200 bg-white text-emerald-900",
    icon: CheckCircle2,
    iconColor: "text-emerald-600",
  },
  danger: {
    wrap: "border-rose-200 bg-white text-rose-900",
    icon: AlertTriangle,
    iconColor: "text-rose-600",
  },
  info: {
    wrap: "border-sky-200 bg-white text-sky-900",
    icon: Info,
    iconColor: "text-sky-600",
  },
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end">
      {toasts.map((toast) => {
        const tone = toastToneStyles[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={cx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg shadow-slate-900/10 animate-toast-in",
              tone.wrap
            )}
          >
            <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", tone.iconColor)} aria-hidden />
            <span className="min-w-0 flex-1">{toast.text}</span>
            <button
              className="rounded-md p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={() => onDismiss(toast.id)}
              title="Fechar"
              type="button"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon: Icon, text, hint }: { icon?: LucideIcon; text: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
      {Icon ? <Icon className="h-6 w-6 text-slate-400" aria-hidden /> : null}
      <p className="mt-2 text-sm font-medium text-slate-600">{text}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Seções                                                              */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  eyebrow,
  icon: Icon,
  subtitle,
  title,
}: {
  eyebrow: string;
  icon: LucideIcon;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{eyebrow}</p>
        <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function SegmentedButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
        active
          ? "border-slate-950 bg-slate-950 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950"
      )}
      aria-pressed={active}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

export function InfoLine({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[24px_96px_1fr] items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden />
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal e confirmação                                                 */
/* ------------------------------------------------------------------ */

export function Modal({
  children,
  onClose,
  title,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Move o foco para dentro do diálogo e devolve ao elemento de origem.
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-sm animate-fade-in sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cx(
          "w-full rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 outline-none animate-slide-up",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
          <button
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            title="Fechar"
            type="button"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void | Promise<void>;
};

export function ConfirmDialog({
  confirm,
  busy,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} title={confirm.title}>
      <p className="text-sm leading-6 text-slate-600">{confirm.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className={secondaryButton} onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className={dangerButton} disabled={busy} onClick={onConfirm} type="button">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {confirm.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
