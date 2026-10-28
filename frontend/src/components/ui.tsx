"use client";

import { AlertTriangle, Check, Info, Loader2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Botões (classes do protótipo no Figma, ver globals.css)             */
/* ------------------------------------------------------------------ */

export const primaryButton = "btn btn-p";

export const secondaryButton = "btn btn-s";

export const dangerButton = "btn btn-danger";

export const iconButton = "ib sm";

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
    <label className={cx("grid gap-2", className)}>
      <span className="lbl">
        {label}
        {hint ? <span className="hint">{hint}</span> : null}
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

const toastTone: Record<ToastTone, { className: string; icon: LucideIcon }> = {
  success: { className: "ok", icon: Check },
  danger: { className: "err", icon: AlertTriangle },
  info: { className: "info", icon: Info },
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
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2.5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[390px]">
      {toasts.map((toast) => {
        const tone = toastTone[toast.tone];
        const Icon = tone.icon;
        return (
          <div key={toast.id} role="status" className={cx("toast", tone.className)}>
            <span className="t-ico">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold leading-5">{toast.text}</span>
            <button
              className="rounded-lg p-1.5 opacity-70 transition hover:opacity-100"
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
    <div className="empty-inline">
      {Icon ? (
        <span className="empty-ico">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      ) : null}
      <p className="mt-2 text-[15px] font-bold text-ink">{text}</p>
      {hint ? <p className="max-w-sm text-[13px] leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
      {label}
    </span>
  );
}

/** Esqueleto do painel (destaque, KPIs e dois cards) enquanto os dados chegam. */
export function PageSkeleton() {
  // no plano gratuito a API dorme; se demorar, explica a espera
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="pop grid gap-5" role="status">
      <span className="sr-only">Carregando dados da agenda…</span>
      {slow ? (
        <p className="callout blue pop">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.
        </p>
      ) : null}
      <div className="card pad grid gap-3">
        <span className="skel h-3 w-28" />
        <span className="skel h-8 w-2/3" />
        <span className="skel h-4 w-1/2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card pad flex items-center gap-3.5">
            <span className="skel h-11 w-11 shrink-0 !rounded-xl" />
            <span className="grid flex-1 gap-2">
              <span className="skel h-3 w-20" />
              <span className="skel h-6 w-14" />
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {[0, 1].map((card) => (
          <div key={card} className="card pad grid content-start gap-4">
            <span className="grid gap-2">
              <span className="skel h-3 w-24" />
              <span className="skel h-5 w-48" />
            </span>
            {[0, 1, 2, 3].map((row) => (
              <span key={row} className="flex items-center gap-3">
                <span className="skel h-12 w-12 shrink-0 !rounded-xl" />
                <span className="grid flex-1 gap-2">
                  <span className="skel h-3.5 w-3/4" />
                  <span className="skel h-3 w-1/2" />
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seções                                                              */
/* ------------------------------------------------------------------ */

/** Cabeçalho de card: rótulo pequeno, título e subtítulo, como no Figma. */
export function SectionTitle({
  eyebrow,
  subtitle,
  title,
}: {
  eyebrow: string;
  icon?: LucideIcon;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="h2">{title}</h2>
      {subtitle ? <p className="sub">{subtitle}</p> : null}
    </div>
  );
}

/** Grupo de botões segmentados (ex.: Agenda / Calendário). */
export function Segmented({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {children}
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
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={cx(active && "on")} aria-pressed={active} onClick={onClick} type="button">
      {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
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
    <>
      <dt>
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0">{value}</dd>
    </>
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
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[rgb(15_30_58/0.48)] p-4 animate-fade-in sm:p-8"
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
        className={cx("modal-box animate-slide-up", wide && "wide")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line-2 px-6 py-5">
          <h2 className="disp text-[22px] font-bold leading-tight">{title}</h2>
          <button className="ib sm" onClick={onClose} title="Fechar" type="button">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
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
      <p className="text-sm leading-6 text-ink-3">{confirm.message}</p>
      <div className="mt-6 flex justify-end gap-2.5">
        <button className={secondaryButton} onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className="btn btn-d" disabled={busy} onClick={onConfirm} type="button">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {confirm.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
