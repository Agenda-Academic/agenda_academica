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
import { useState } from "react";
import { cx, dateParts, daysUntil, formatDateLong, formatTime, isAllDay, relativeDue } from "@/lib/format";
import { categoryMeta, reminderChips, reminderOffsetLabel, sourceLabels, statusMeta } from "@/lib/meta";
import type { AcademicEvent } from "@/lib/types";
import { InfoLine } from "./ui";

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
  const official = event.officialPriority || event.source !== "teacher";
  // horário de referência fixado na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  const past = new Date(event.endsAt ?? event.startsAt).getTime() < now;
  const sendAt = new Date(new Date(event.startsAt).getTime() - Number(reminderOffset) * 60000);
  const sendPassed = sendAt.getTime() < now;
  const chips = reminderChips.some((chip) => chip.value === reminderOffset)
    ? reminderChips
    : [{ value: reminderOffset, label: reminderOffsetLabel(Number(reminderOffset)).replace(" antes", "") }, ...reminderChips];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("pill", meta.tint)}>{meta.short}</span>
        {event.status !== "scheduled" ? (
          <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>
        ) : null}
        {official ? (
          <span className="pill prio">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Oficial
          </span>
        ) : null}
      </div>
      <h2
        className={cx(
          "disp mt-3 text-[26px] font-bold leading-tight",
          event.status === "cancelled" && "text-faint line-through"
        )}
      >
        {event.title}
      </h2>
      <p className="sub">{sourceLabels[event.source]}</p>

      <dl className="info mt-5">
        <InfoLine icon={CalendarDays} label="Início" value={formatDateLong(event.startsAt)} />
        {event.endsAt ? <InfoLine icon={CalendarClock} label="Término" value={formatDateLong(event.endsAt)} /> : null}
        <InfoLine icon={MapPin} label="Local" value={event.location ?? "Não informado"} />
        <InfoLine icon={BookOpen} label="Disciplina" value={event.subject?.name ?? "Institucional"} />
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Todas"} />
        <InfoLine icon={UserRound} label="Responsável" value={event.teacher?.fullName ?? "Institucional"} />
        <InfoLine
          icon={ListChecks}
          label="Pontuação"
          value={event.points === null ? "Não informada" : `${event.points} pts (informativa)`}
        />
      </dl>

      <p className="callout past mt-5">{event.description ?? "Sem descrição complementar."}</p>

      <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[15px] font-bold">Lembrete pessoal</p>
          <span className={cx("pill", reminder ? "st-conc" : "st-ag")}>
            {reminder ? (
              <>
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Ativo
              </>
            ) : (
              "Desligado"
            )}
          </span>
        </div>
        <p className="lbl mt-4 mb-2">Antecedência</p>
        <div className="chips" role="group" aria-label="Antecedência do lembrete">
          {chips.map((chip) => (
            <button
              key={chip.value}
              className={cx("chip", reminderOffset === chip.value && "all")}
              aria-pressed={reminderOffset === chip.value}
              onClick={() => setReminderOffset(chip.value)}
              type="button"
            >
              {chip.label}
            </button>
          ))}
        </div>
        <p className={cx("field-help mt-3", (past || sendPassed) && "font-semibold text-[#B4234A]")}>
          {past
            ? "O evento já aconteceu — não há lembrete a enviar."
            : sendPassed
              ? "Esse horário de aviso já passou. Escolha uma antecedência menor."
              : `Você será avisado ${formatDateLong(sendAt.toISOString())}, pelo canal do seu perfil.`}
        </p>
        <div className="mt-3.5 flex gap-2.5">
          <button
            className="btn btn-p flex-1"
            disabled={saving || past || sendPassed}
            onClick={onSaveReminder}
            type="button"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
            {reminder ? "Atualizar lembrete" : "Ativar lembrete"}
          </button>
          {reminder ? (
            <button
              className="btn btn-danger px-3.5"
              disabled={saving}
              onClick={() => onRemoveReminder(event)}
              title="Remover lembrete"
              aria-label="Remover lembrete"
              type="button"
            >
              <BellOff className="h-[18px] w-[18px]" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="mt-5 grid gap-2.5 border-t border-line-2 pt-5">
          <p className="eyebrow">Gestão do evento</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button className="btn btn-s" onClick={() => onEdit(event)} type="button">
              <Edit3 className="h-4 w-4" aria-hidden />
              Editar
            </button>
            {event.status === "scheduled" || event.status === "changed" ? (
              <button className="btn btn-s" disabled={saving} onClick={() => onSetStatus(event, "completed")} type="button">
                <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />
                Concluir
              </button>
            ) : (
              <button className="btn btn-s" disabled={saving} onClick={() => onSetStatus(event, "scheduled")} type="button">
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reativar
              </button>
            )}
            {event.status === "scheduled" || event.status === "changed" ? (
              <button className="btn btn-s" disabled={saving} onClick={() => onSetStatus(event, "cancelled")} type="button">
                <X className="h-4 w-4 text-[#B4234A]" aria-hidden />
                Cancelar evento
              </button>
            ) : null}
            <button className="btn btn-danger" onClick={() => onDelete(event)} type="button">
              <Trash2 className="h-4 w-4" aria-hidden />
              Excluir
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="empty-ico">
        <PanelRightOpen className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold">Selecione um evento</p>
      <p className="max-w-[240px] text-[13px] leading-5 text-muted">
        Os detalhes, o lembrete pessoal e as ações aparecem aqui.
      </p>
    </div>
  );
}

export function eventDetailSavingSpinner(saving: boolean) {
  return saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;
}
