"use client";

import {
  Bell,
  BellOff,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Edit3,
  ListChecks,
  Loader2,
  MapPin,
  PanelRightOpen,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cx, dateParts, daysUntil, formatDateLong, formatTime, isAllDay, relativeDue } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel, reminderOptions, sourceLabels, statusMeta } from "@/lib/meta";
import type { AcademicEvent } from "@/lib/types";
import { Field, InfoLine, dangerButton, secondaryButton } from "./ui";

export function EventRow({
  event,
  hideClass,
  mine,
  selected,
  onClick,
}: {
  /** Mantido por compatibilidade: a linha sempre mostra a data relativa. */
  compact?: boolean;
  event: AcademicEvent;
  /** Oculta o nome da turma (visão de aluno, que só tem uma). */
  hideClass?: boolean;
  /** Marca eventos publicados pelo próprio usuário (visão docente). */
  mine?: boolean;
  selected?: boolean;
  separated?: boolean;
  onClick: () => void;
}) {
  const meta = categoryMeta[event.category];
  const cancelled = event.status === "cancelled";
  const official = event.officialPriority || event.source !== "teacher";
  const parts = dateParts(event.startsAt);
  const days = daysUntil(event.startsAt);
  const details = [
    event.subject?.name,
    !hideClass ? event.academicClass?.name : null,
    event.location,
    event.points !== null ? `${event.points} pts` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className={cx("ev", selected && "sel")} onClick={onClick} type="button">
      <span className="ev-date">
        <span className="dw">{parts.weekday}</span>
        <span className="dn">{parts.day}</span>
      </span>
      <span className="ev-body">
        <span className={cx("ev-title block", cancelled && "text-faint line-through")}>{event.title}</span>
        <span className="ev-meta">
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          {official ? (
            <span className="pill prio">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Oficial
            </span>
          ) : null}
          {event.status !== "scheduled" ? (
            <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>
          ) : null}
          {mine ? <span className="pill st-conc">Sua publicação</span> : null}
          {details ? <span className="det min-w-0 truncate">{details}</span> : null}
        </span>
      </span>
      <span className="ev-when">
        <span className="ev-time block">{isAllDay(event.startsAt) ? "Dia todo" : formatTime(event.startsAt)}</span>
        <span className={cx("ev-rel block", days >= 0 && days <= 1 && "soon")}>{relativeDue(event.startsAt)}</span>
      </span>
    </button>
  );
}

export function EventDetailContent({
  canManage,
  event,
  reminderOffset,
  saving,
  setReminderOffset,
  onDelete,
  onEdit,
  onRemoveReminder,
  onSaveReminder,
  onSetStatus,
}: {
  canManage: boolean;
  event: AcademicEvent;
  reminderOffset: string;
  saving: boolean;
  setReminderOffset: (value: string) => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSetStatus: (event: AcademicEvent, status: "scheduled" | "completed" | "cancelled") => void;
}) {
  const meta = categoryMeta[event.category];
  const reminder = event.reminder ?? null;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold", meta.pill)}>
              {meta.short}
            </span>
            {event.status !== "scheduled" ? (
              <span
                className={cx(
                  "inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold",
                  statusMeta[event.status].pill
                )}
              >
                {statusMeta[event.status].label}
              </span>
            ) : null}
            {event.officialPriority || event.source !== "teacher" ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Oficial
              </span>
            ) : null}
          </div>
          <h2
            className={cx(
              "mt-3 text-2xl font-semibold leading-tight tracking-tight",
              event.status === "cancelled" ? "text-slate-400 line-through" : "text-slate-950"
            )}
          >
            {event.title}
          </h2>
          <p className="mt-2 text-sm text-slate-500">{sourceLabels[event.source]}</p>
        </div>
        <span className={cx("mt-1 h-3 w-3 shrink-0 rounded-full", meta.accent)} aria-hidden />
      </div>

      <dl className="info mt-6">
        <InfoLine icon={CalendarDays} label="Início" value={formatDateLong(event.startsAt)} />
        {event.endsAt ? (
          <InfoLine icon={CalendarClock} label="Término" value={formatDateLong(event.endsAt)} />
        ) : null}
        <InfoLine icon={MapPin} label="Local" value={event.location ?? "Não informado"} />
        <InfoLine icon={BookOpen} label="Disciplina" value={event.subject?.name ?? "Institucional"} />
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Todos"} />
        <InfoLine
          icon={UserRound}
          label="Responsável"
          value={event.teacher?.fullName ?? "Institucional"}
        />
        <InfoLine
          icon={ListChecks}
          label="Pontuação"
          value={event.points === null ? "Não informada" : `${event.points} pts (informativa)`}
        />
      </dl>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm leading-6 text-slate-700">
          {event.description ?? "Sem descrição complementar."}
        </p>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <Field
          label="Lembrete pessoal"
          hint={reminder ? `ativo · ${reminderOffsetLabel(reminder.offsetMinutes)}` : "nenhum configurado"}
        >
          <select
            className="input"
            value={reminderOffset}
            onChange={(eventTarget) => setReminderOffset(eventTarget.target.value)}
          >
            {reminderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className={cx("mt-3 grid gap-2", reminder ? "grid-cols-[1fr_auto]" : "")}>
          <button
            className={cx(secondaryButton, "w-full")}
            disabled={saving}
            onClick={onSaveReminder}
            type="button"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {reminder ? "Atualizar lembrete" : "Ativar lembrete"}
          </button>
          {reminder ? (
            <button
              className={cx(secondaryButton, "text-rose-600 hover:text-rose-700")}
              disabled={saving}
              onClick={() => onRemoveReminder(event)}
              title="Remover lembrete"
              type="button"
            >
              <BellOff className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="mt-5 grid gap-2 border-t border-slate-200 pt-4">
          <div className="grid grid-cols-2 gap-2">
            <button className={secondaryButton} onClick={() => onEdit(event)} type="button">
              <Edit3 className="h-4 w-4" aria-hidden />
              Editar
            </button>
            <button className={dangerButton} onClick={() => onDelete(event)} type="button">
              <Trash2 className="h-4 w-4" aria-hidden />
              Excluir
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {event.status === "scheduled" || event.status === "changed" ? (
              <>
                <button
                  className={cx(secondaryButton, "text-emerald-700")}
                  disabled={saving}
                  onClick={() => onSetStatus(event, "completed")}
                  type="button"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Concluir
                </button>
                <button
                  className={cx(secondaryButton, "text-rose-600")}
                  disabled={saving}
                  onClick={() => onSetStatus(event, "cancelled")}
                  type="button"
                >
                  <X className="h-4 w-4" aria-hidden />
                  Cancelar
                </button>
              </>
            ) : (
              <button
                className={cx(secondaryButton, "col-span-2")}
                disabled={saving}
                onClick={() => onSetStatus(event, "scheduled")}
                type="button"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reagendar como ativo
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div className="grid min-h-72 place-items-center p-6 text-center">
      <div>
        <PanelRightOpen className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
        <p className="mt-3 text-sm font-medium text-slate-600">
          Selecione um evento para ver os detalhes.
        </p>
      </div>
    </div>
  );
}

export function eventDetailSavingSpinner(saving: boolean) {
  return saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;
}
