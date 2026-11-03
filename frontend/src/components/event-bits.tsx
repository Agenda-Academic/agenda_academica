"use client";

import {
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CheckCircle2,
  Edit3,
  Loader2,
  MapPin,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { cx, dateParts, daysUntil, formatTime, isAllDay, relativeDue, startOfDay } from "@/lib/format";
import { categoryMeta, reminderChips, reminderShortLabel, showsOfficialPill, sourceText, statusMeta } from "@/lib/meta";
import type { AcademicEvent } from "@/lib/types";
import { isOnTopLayer } from "./ui";

/* ------------------------------------------------------------------ */
/* Datas curtas do detalhe e das linhas                                */
/* ------------------------------------------------------------------ */

const shortWeekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function clock(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "qui, 05/11" */
export function shortDay(date: Date) {
  return `${shortWeekdays[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** "qua, 04/11, às 19:00" */
export function formatNoticeAt(date: Date) {
  return `${shortDay(date)}, às ${clock(date)}`;
}

const weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// sábado e domingo pedem "no"; os outros dias, "na"
function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

/** Em frase, o dia da semana por extenso e com o artigo certo: "na quarta, 04/11" ou "no sábado, 07/11". */
export function onDay(date: Date) {
  return `${isWeekend(date) ? "no" : "na"} ${weekdayNames[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** "na quarta, 04/11, às 19:00" ou "no domingo, 08/11, às 19:00" */
function onNotice(date: Date) {
  return `${onDay(date)}, às ${clock(date)}`;
}

function atMidnight(date: Date) {
  return date.getHours() === 0 && date.getMinutes() === 0;
}

/** Último dia em que o evento acontece. Término às 00:00 não conta aquele dia. */
export function eventLastDay(event: Pick<AcademicEvent, "startsAt" | "endsAt">) {
  const first = startOfDay(new Date(event.startsAt));
  if (!event.endsAt) {
    return first;
  }
  const end = new Date(event.endsAt);
  const last = atMidnight(end) ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1) : startOfDay(end);
  return last < first ? first : last;
}

export function isMultiDay(event: AcademicEvent) {
  return eventLastDay(event).getTime() > startOfDay(new Date(event.startsAt)).getTime();
}

/** Começa às 00:00 e termina às 00:00 ou 23:59 (ou não tem término). */
function isWholeDay(event: AcademicEvent) {
  if (!isAllDay(event.startsAt)) {
    return false;
  }
  if (!event.endsAt) {
    return true;
  }
  const end = new Date(event.endsAt);
  return atMidnight(end) || (end.getHours() === 23 && end.getMinutes() === 59);
}

/** "seg, 16/11 a qua, 18/11, dia todo" ou "qui, 05/11, 19:00 até 21:00". */
export function formatEventWhen(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  const last = eventLastDay(event);
  const multi = last.getTime() > startOfDay(start).getTime();
  if (isWholeDay(event)) {
    return multi ? `${shortDay(start)} a ${shortDay(last)}, dia todo` : `${shortDay(start)}, dia todo`;
  }
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || end <= start) {
    return `${shortDay(start)}, ${clock(start)}`;
  }
  return multi
    ? `${shortDay(start)}, ${clock(start)} até ${shortDay(end)}, ${clock(end)}`
    : `${shortDay(start)}, ${clock(start)} até ${clock(end)}`;
}

/** "16 a 18/11" ou "30/11 a 02/12", na linha de evento de vários dias. */
export function formatDayRange(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  const last = eventLastDay(event);
  const tail = `${pad(last.getDate())}/${pad(last.getMonth() + 1)}`;
  return start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear()
    ? `${pad(start.getDate())} a ${tail}`
    : `${pad(start.getDate())}/${pad(start.getMonth() + 1)} a ${tail}`;
}

/** Evento de vários dias que já começou e ainda não acabou. */
function isOngoing(event: AcademicEvent) {
  return isMultiDay(event) && daysUntil(event.startsAt) < 0 && daysUntil(eventLastDay(event).toISOString()) >= 0;
}

function pointsText(points: number) {
  return `Vale ${points.toLocaleString("pt-BR")} ponto${points === 1 ? "" : "s"}`;
}

/** Situação que os botões pedem. "changed" é a volta de um evento cancelado. */
export type EventStatusChange = "scheduled" | "changed" | "completed" | "cancelled";

/** Reativar: o cancelado volta como Alterado, para a turma ver que ele voltou; o concluído volta a Agendado. */
export function reactivatedStatus(event: AcademicEvent): EventStatusChange {
  return event.status === "cancelled" ? "changed" : "scheduled";
}

export function StatusPill({ event }: { event: AcademicEvent }) {
  if (event.status === "scheduled") {
    return null;
  }
  const status = statusMeta[event.status];
  const Icon = status.icon;
  return (
    <span className={cx("pill", status.pill)}>
      <Icon className="h-3 w-3" aria-hidden />
      {status.label}
    </span>
  );
}

function OfficialPill() {
  return (
    <span className="pill prio">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Oficial
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Linha de evento                                                     */
/* ------------------------------------------------------------------ */

export function EventRow({
  event,
  hideClass,
  hideDate,
  saved,
  selected,
  showMonth,
  showTeacher,
  onClick,
}: {
  /** Mantido por compatibilidade: a linha sempre mostra a data relativa. */
  compact?: boolean;
  event: AcademicEvent;
  /** Oculta o nome da turma (visão de aluno, que só tem uma). */
  hideClass?: boolean;
  /** Sem o bloco de data (lista de um dia só, em que a data já está no título). */
  hideDate?: boolean;
  /** Mantido por compatibilidade: os eventos da própria pessoa não ganham mais pílula. */
  mine?: boolean;
  /** Salvo há pouco pelo painel lateral: pílula "Salvo agora" (a mesma da Gestão). */
  saved?: boolean;
  selected?: boolean;
  separated?: boolean;
  /** Mostra o mês no bloco de data, para listas que atravessam meses. */
  showMonth?: boolean;
  /** Mostra quem publicou (eventos de colegas na visão docente). */
  showTeacher?: boolean;
  onClick: () => void;
}) {
  const meta = categoryMeta[event.category];
  const cancelled = event.status === "cancelled";
  const parts = dateParts(event.startsAt);
  const days = daysUntil(event.startsAt);
  const multi = isMultiDay(event);
  const ongoing = isOngoing(event);
  const hasReminder = Boolean(event.reminder && event.reminder.enabled !== false);
  const details = [
    event.subject?.name,
    !hideClass ? event.academicClass?.name : null,
    showTeacher ? event.teacher?.fullName : null,
    event.location,
    event.points !== null ? `${event.points} pts` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cx("ev", selected && "sel")}
      data-event-id={event.id}
      onClick={onClick}
      type="button"
    >
      {hideDate ? null : (
        <span className="ev-date">
          <span className="dw">{parts.weekday}</span>
          <span className="dn">{parts.day}</span>
          {showMonth ? <span className="dw">{parts.month}</span> : null}
        </span>
      )}
      <span className="ev-body">
        <span className={cx("ev-title block", cancelled && "text-muted line-through")}>{event.title}</span>
        <span className="ev-meta">
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          <StatusPill event={event} />
          {saved ? (
            <span className="pill bg-brand text-white">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Salvo agora
            </span>
          ) : null}
          {showsOfficialPill(event) ? <OfficialPill /> : null}
          {hasReminder ? (
            <span className="inline-flex items-center text-brand" title="Lembrete ativo">
              <Bell className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">lembrete ativo</span>
            </span>
          ) : null}
          {details ? <span className="det min-w-0 truncate">{details}</span> : null}
        </span>
      </span>
      <span className="ev-when">
        <span className="ev-time block">
          {multi ? formatDayRange(event) : isWholeDay(event) ? "Dia todo" : formatTime(event.startsAt)}
        </span>
        <span className={cx("ev-rel block", (ongoing || (days >= 0 && days <= 1)) && "soon")}>
          {ongoing ? "em andamento" : relativeDue(event.startsAt)}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe do evento                                                   */
/* ------------------------------------------------------------------ */

type BusyKey = "save" | "remove" | EventStatusChange;

// botão indisponível sem "disabled", para o foco não cair no body durante o envio
const softOff = "aria-disabled:cursor-not-allowed! aria-disabled:opacity-60";

/** Foca o alvo assim que nenhum outro diálogo estiver por cima (ex.: a confirmação de cancelar). */
function focusWhenFree(getTarget: () => HTMLElement | null, tries = 40) {
  const target = getTarget();
  if (target?.isConnected) {
    // vale só a camada de cima da pilha (as de baixo continuam montadas, com aria-modal, mas inertes)
    const blocked = !isOnTopLayer(target);
    if (!blocked) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  if (tries > 0) {
    window.setTimeout(() => focusWhenFree(getTarget, tries - 1), 100);
  }
}

export function EventDetailContent({
  canManage,
  cornerSpace,
  event,
  reminderOffset,
  saving,
  setReminderOffset,
  titleRef,
  onDelete,
  onEdit,
  onRemoveReminder,
  onSaveReminder,
  onSetStatus,
}: {
  canManage: boolean;
  /** Deixa espaço no canto de cima à direita para o botão de fechar do painel. */
  cornerSpace?: boolean;
  event: AcademicEvent;
  reminderOffset: string;
  saving: boolean;
  setReminderOffset: (value: string) => void;
  /** Título do detalhe (tabIndex -1), para o Cronograma levar o foco até ele. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSetStatus: (event: AcademicEvent, status: EventStatusChange) => void;
}) {
  const meta = categoryMeta[event.category];
  const cancelled = event.status === "cancelled";
  const active = event.status === "scheduled" || event.status === "changed";
  const official = event.source !== "teacher";
  const ids = useId();

  // horário de referência (render precisa ser puro); atualiza a cada 30 s
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // botão que disparou o envio em andamento (spinner e aria-busy só nele)
  const [busyKey, setBusyKey] = useState<BusyKey | null>(null);
  if (!saving && busyKey !== null) {
    setBusyKey(null);
  }
  const busy = saving ? busyKey : null;

  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const reminderButtonRef = useRef<HTMLButtonElement>(null);
  // pedido de foco feito no clique (timeStamp do evento, na mesma base de performance.now)
  const focusRequest = useRef<{ kind: "status" | "reminder"; at: number } | null>(null);

  /* ---------------- lembrete ---------------- */
  const startsAt = new Date(event.startsAt).getTime();
  const ended = new Date(event.endsAt ?? event.startsAt).getTime() <= now;
  const saved = event.reminder && event.reminder.enabled !== false ? event.reminder : null;
  const closed = startsAt <= now || cancelled || event.status === "completed";
  const draft = Number(reminderOffset);
  const isValid = (minutes: number) => startsAt - minutes * 60000 > now;
  const offsets = Array.from(
    new Set([...reminderChips.map((chip) => Number(chip.value)), ...(saved ? [saved.offsetMinutes] : []), draft])
  )
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 15)
    .sort((a, b) => a - b);
  const validOffsets = offsets.filter(isValid);
  const largestValid = validOffsets.length ? validOffsets[validOffsets.length - 1] : null;
  // sem lembrete salvo, uma antecedência que já passou vira a maior que ainda dá tempo
  const autoPick = !saved && !closed && !isValid(draft) && largestValid !== null;
  const chosen = autoPick ? largestValid : draft;
  const dirty = saved !== null && chosen !== saved.offsetMinutes;
  const chosenAt = new Date(startsAt - chosen * 60000);
  const savedAt = saved ? new Date(startsAt - saved.offsetMinutes * 60000) : null;
  const minutesToStart = Math.max(1, Math.round((startsAt - now) / 60000));

  useEffect(() => {
    if (autoPick && largestValid !== null) {
      setReminderOffset(String(largestValid));
    }
  }, [autoPick, largestValid, setReminderOffset]);

  // a ação concluída tira o botão de lugar: o foco vai para o botão novo
  useEffect(() => {
    const request = focusRequest.current;
    if (request?.kind === "status" && performance.now() - request.at < 20000) {
      focusRequest.current = null;
      focusWhenFree(() => statusButtonRef.current);
    }
  }, [event.status]);

  const savedId = saved?.id ?? null;
  useEffect(() => {
    const request = focusRequest.current;
    if (request?.kind === "reminder" && performance.now() - request.at < 20000) {
      focusRequest.current = null;
      focusWhenFree(() => reminderButtonRef.current ?? titleRef?.current ?? null);
    }
  }, [savedId, titleRef]);

  function changeStatus(status: EventStatusChange, at: number) {
    if (saving) {
      return;
    }
    setBusyKey(status);
    focusRequest.current = { kind: "status", at };
    onSetStatus(event, status);
  }

  function saveReminder() {
    if (saving || (saved && !dirty)) {
      return;
    }
    setBusyKey("save");
    onSaveReminder();
  }

  function removeReminder(at: number) {
    if (saving) {
      return;
    }
    setBusyKey("remove");
    focusRequest.current = { kind: "reminder", at };
    onRemoveReminder(event);
  }

  function discardChange() {
    if (!saved) {
      return;
    }
    setReminderOffset(String(saved.offsetMinutes));
    window.requestAnimationFrame(() => reminderButtonRef.current?.focus());
  }

  function statusButton(status: EventStatusChange, label: string, Icon: LucideIcon, iconClass?: string) {
    const isBusy = busy === status;
    return (
      <button
        key={status}
        ref={status === "cancelled" ? undefined : statusButtonRef}
        aria-busy={isBusy || undefined}
        aria-disabled={saving || undefined}
        className={cx("btn btn-s", softOff)}
        onClick={(click) => changeStatus(status, click.timeStamp)}
        type="button"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className={cx("h-4 w-4", iconClass)} aria-hidden />}
        {label}
      </button>
    );
  }

  const facts = [
    event.subject?.name ? { label: "Disciplina", value: event.subject.name } : null,
    !official && event.academicClass?.name ? { label: "Turma", value: event.academicClass.name } : null,
    event.points !== null ? { label: "Pontuação", value: pointsText(event.points) } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  const relative = isOngoing(event)
    ? "em andamento"
    : Math.abs(daysUntil(event.startsAt)) <= 30
      ? relativeDue(event.startsAt)
      : null;

  const removeButton = (
    <button
      key="remove"
      aria-busy={busy === "remove" || undefined}
      aria-disabled={saving || undefined}
      className={cx("btn btn-sm text-[var(--danger)] hover:bg-surface-2", softOff)}
      onClick={(click) => removeReminder(click.timeStamp)}
      type="button"
    >
      {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
      Remover lembrete
    </button>
  );

  function reminderBox() {
    if (closed) {
      if (!saved) {
        return null;
      }
      return (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="min-w-0 flex-1 text-sm leading-5 text-ink-3">
            {cancelled
              ? "O evento foi cancelado. Seu lembrete não vale mais."
              : event.status === "completed"
                ? "O evento foi concluído. Seu lembrete não vale mais."
                : ended
                  ? "O evento já passou. Seu lembrete não vale mais."
                  : "O evento já começou. Seu lembrete não vale mais."}
          </p>
          {removeButton}
        </div>
      );
    }

    const noTime = validOffsets.length === 0;
    const statePill = !saved ? (
      <span className="pill stat">
        <BellOff className="h-3 w-3" aria-hidden />
        Sem lembrete
      </span>
    ) : dirty ? (
      <span className="pill stat stat-alt">
        <Pencil className="h-3 w-3" aria-hidden />
        Alteração não salva
      </span>
    ) : (
      <span className="pill stat stat-conc">
        <Check className="h-3 w-3" aria-hidden />
        Ativo
      </span>
    );

    let stateText: string;
    if (!saved || !savedAt) {
      stateText = noTime
        ? `Começa em ${minutesToStart} min. Não dá mais para agendar aviso.`
        : `O aviso apareceria ${onNotice(chosenAt)}.`;
    } else if (dirty) {
      stateText = `Com ${reminderShortLabel(chosen)} de antecedência, o aviso passa a ser ${onNotice(chosenAt)}.`;
    } else {
      stateText =
        savedAt.getTime() > now
          ? `Lembrete ativo: aviso ${onNotice(savedAt)}, aqui no sistema.`
          : `Lembrete ativo: o aviso já apareceu ${onNotice(savedAt)}.`;
    }

    return (
      <section className="mt-5 rounded-2xl border border-line bg-surface-2 p-4" aria-labelledby={`${ids}-lembrete`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${ids}-lembrete`} className="text-[15px] font-bold">
            Lembrete pessoal
          </h3>
          {statePill}
        </div>

        {noTime ? null : (
          <>
            <p id={`${ids}-antecedencia`} className="lbl mt-4 mb-2">
              Antecedência
            </p>
            <div className="chips" role="group" aria-labelledby={`${ids}-antecedencia`}>
              {offsets.map((minutes) => {
                const valid = isValid(minutes);
                const on = chosen === minutes;
                return (
                  <button
                    key={minutes}
                    aria-disabled={!valid || undefined}
                    aria-pressed={on}
                    className={cx("chip", on && "all", !valid && !on && "lock")}
                    onClick={() => {
                      if (valid && !saving) {
                        setReminderOffset(String(minutes));
                      }
                    }}
                    title={valid ? undefined : "Já passou"}
                    type="button"
                  >
                    {reminderShortLabel(minutes)}
                    {valid ? null : <span className="sr-only">, já passou</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <p className="field-help mt-3" role="status">
          {stateText}
        </p>

        {noTime && !saved ? null : (
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            {!saved || dirty ? (
              <button
                key="primary"
                ref={reminderButtonRef}
                aria-busy={busy === "save" || undefined}
                aria-disabled={saving || undefined}
                className={cx("btn btn-p flex-1", softOff)}
                onClick={saveReminder}
                type="button"
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
                {saved ? "Salvar alteração" : "Ativar lembrete"}
              </button>
            ) : (
              <button
                key="primary"
                ref={reminderButtonRef}
                aria-disabled="true"
                className={cx("btn btn-p flex-1", softOff)}
                onClick={saveReminder}
                title="Escolha outra antecedência para atualizar"
                type="button"
              >
                <Bell className="h-4 w-4" aria-hidden />
                Atualizar lembrete
              </button>
            )}
            {saved && dirty ? (
              <button key="discard" className="btn btn-s" onClick={discardChange} type="button">
                Descartar
              </button>
            ) : null}
            {saved && !dirty ? removeButton : null}
          </div>
        )}

        <p className="field-help mt-3">
          O aviso aparece aqui no sistema. O envio por <span className="whitespace-nowrap">e-mail</span> é o próximo passo.
        </p>
      </section>
    );
  }

  return (
    <div>
      <div className={cx("flex flex-wrap items-center gap-2", cornerSpace && "min-h-[38px] pr-12")}>
        <span className={cx("pill", meta.tint)}>{meta.short}</span>
        <StatusPill event={event} />
        {showsOfficialPill(event) ? <OfficialPill /> : null}
      </div>
      <h2
        ref={titleRef}
        tabIndex={-1}
        className={cx("disp mt-3 text-[26px] font-bold leading-tight", cancelled && "text-muted line-through")}
      >
        {event.title}
      </h2>
      <p className="sub">{sourceText(event)}</p>

      {cancelled ? (
        <p className="callout rose mt-4">
          <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Evento cancelado. Ele continua aqui só para consulta.
        </p>
      ) : null}
      {event.status === "changed" ? (
        <p className="callout amber mt-4">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Evento alterado depois de publicado. Confira a data, o horário e o local.
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 text-[15px] leading-6 text-ink-2">
        <p className="flex items-start gap-2.5">
          <CalendarDays className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="font-semibold">{formatEventWhen(event)}</span>
            {relative ? <span className="text-muted">, {relative}</span> : null}
          </span>
        </p>
        {event.location ? (
          <p className="flex items-start gap-2.5">
            <MapPin className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span>{event.location}</span>
          </p>
        ) : null}
      </div>

      {canManage ? (
        <div className="mt-5 grid grid-cols-2 gap-2.5" role="group" aria-label="Ações do evento">
          <button className="btn btn-p" onClick={() => onEdit(event)} type="button">
            <Edit3 className="h-4 w-4" aria-hidden />
            Editar
          </button>
          {active
            ? statusButton("completed", "Concluir", CheckCircle2, "text-brand")
            : statusButton(reactivatedStatus(event), "Reativar", RotateCcw)}
          {active ? statusButton("cancelled", "Cancelar evento", X, "text-[var(--danger)]") : null}
          <button
            aria-disabled={saving || undefined}
            className={cx("btn btn-danger", softOff)}
            onClick={() => {
              if (!saving) {
                onDelete(event);
              }
            }}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir
          </button>
        </div>
      ) : null}

      {reminderBox()}

      {facts.length ? (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[13px] text-muted">{fact.label}</dt>
              <dd className="mt-0.5 break-words font-semibold text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {event.description ? <p className="callout past mt-5 whitespace-pre-line">{event.description}</p> : null}
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
