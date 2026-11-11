"use client";

import {
  Award,
  Bell,
  BellOff,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  MapPin,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { cx, dateParts, daysUntil, formatTime, isAllDay, relativeDue, startOfDay } from "@/lib/format";
import { categoryMeta, reminderChips, reminderShortLabel, showsOfficialPill, sourceText, statusMeta } from "@/lib/meta";
import type { AcademicEvent } from "@/lib/types";
import { InfoLine, isOnTopLayer } from "./ui";

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

/* ------------------------------------------------------------------ */
/* Dados do detalhe (ordem do Figma: início, término, local...)        */
/* ------------------------------------------------------------------ */

/** Depois de "até": "a quarta, 18/11" ou "o sábado, 21/11". */
function toDay(date: Date) {
  return `${isWeekend(date) ? "o" : "a"} ${weekdayNames[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "faltam 1 dia e 11 horas", "faltam 3 horas e 20 min" ou "falta 1 hora". */
function timeLeft(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? "dia" : "dias"}` : null,
    hours ? `${hours} ${hours === 1 ? "hora" : "horas"}` : null,
    !days && rest ? `${rest} min` : null,
  ].filter((part): part is string => part !== null);
  const single = parts.length === 1 && parts[0].startsWith("1 ");
  return `${single ? "falta" : "faltam"} ${parts.join(" e ")}`;
}

export type EventWhenSummary = { tone: "green" | "past"; head: string; tail: string | null };

/**
 * Quando é o evento em relação a agora, no bloco do alto do detalhe (Figma): "Amanhã às 19:00,
 * faltam 1 dia e 11 horas", "Em andamento, até a quarta, 18/11" ou "Já passou, ontem".
 * Cancelado e concluído não têm o bloco: a pílula e o aviso já dizem a situação.
 */
export function eventWhenSummary(event: AcademicEvent, now: number): EventWhenSummary | null {
  if (event.status === "cancelled" || event.status === "completed") {
    return null;
  }
  const start = new Date(event.startsAt);
  const startMs = start.getTime();
  const wholeDay = isWholeDay(event);
  const last = eventLastDay(event);
  const multi = last.getTime() > startOfDay(start).getTime();
  const endDate = event.endsAt ? new Date(event.endsAt) : null;
  const end = endDate && endDate.getTime() > startMs ? endDate : null;
  // fim: no dia todo, a meia-noite depois do último dia; senão o término ou, sem ele, o próprio início
  const endMs = wholeDay
    ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime()
    : (end?.getTime() ?? startMs);
  const days = Math.round((startOfDay(start).getTime() - startOfDay(new Date(now)).getTime()) / 86400000);
  const day = days === 0 ? "Hoje" : days === 1 ? "Amanhã" : capitalize(onDay(start));

  if (startMs > now) {
    if (wholeDay) {
      return {
        tone: "green",
        head: multi ? `${day}, até ${toDay(last)}` : `${day}, dia todo`,
        tail: days > 1 ? `faltam ${days} dias` : null,
      };
    }
    // "Amanhã às 19:00" e "Na quarta, 04/11, às 19:00"
    return { tone: "green", head: `${day}${days > 1 ? "," : ""} às ${clock(start)}`, tail: timeLeft(startMs - now) };
  }
  if (now < endMs) {
    if (multi) {
      return { tone: "green", head: "Em andamento", tail: `até ${toDay(last)}${!wholeDay && end ? `, às ${clock(end)}` : ""}` };
    }
    return wholeDay
      ? { tone: "green", head: "Hoje, dia todo", tail: null }
      : { tone: "green", head: "Acontecendo agora", tail: `até ${clock(end ?? start)}` };
  }
  return {
    tone: "past",
    head: "Já passou",
    tail: days === 0 ? (wholeDay ? "hoje" : `hoje às ${clock(start)}`) : relativeDue(event.startsAt),
  };
}

/** Início no rótulo curto do glossário: "qui, 05/11, 19:00", "seg, 02/11, dia todo" ou "seg, 16/11". */
export function eventStartLabel(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  if (isWholeDay(event)) {
    return isMultiDay(event) ? shortDay(start) : `${shortDay(start)}, dia todo`;
  }
  return `${shortDay(start)}, ${clock(start)}`;
}

/** Término no mesmo formato ("qui, 05/11, 21:00"); no dia todo de vários dias, o último dia. Sem término, null. */
export function eventEndLabel(event: AcademicEvent) {
  if (isWholeDay(event)) {
    return isMultiDay(event) ? shortDay(eventLastDay(event)) : null;
  }
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || end.getTime() <= new Date(event.startsAt).getTime()) {
    return null;
  }
  return `${shortDay(end)}, ${clock(end)}`;
}

/** Situação que os botões pedem. "changed" é a volta de um evento cancelado. */
export type EventStatusChange = "scheduled" | "changed" | "completed" | "cancelled";

/** Reativar: o cancelado volta como Alterado, para a turma ver que ele voltou; o concluído volta a Agendado. */
export function reactivatedStatus(event: AcademicEvent): EventStatusChange {
  return event.status === "cancelled" ? "changed" : "scheduled";
}

/**
 * Situação em pílula cheia, como no Figma (Guia visual): Agendado, Alterado, Concluído e Cancelado.
 * Nas linhas, "Agendado" não aparece; no detalhe (showScheduled), aparece como no Figma.
 */
export function StatusPill({ event, showScheduled = false }: { event: AcademicEvent; showScheduled?: boolean }) {
  if (event.status === "scheduled" && !showScheduled) {
    return null;
  }
  const status = statusMeta[event.status];
  return <span className={cx("pill", status.pill)}>{status.label}</span>;
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
  const time = multi ? formatDayRange(event) : isWholeDay(event) ? "Dia todo" : formatTime(event.startsAt);
  const rel = ongoing ? "em andamento" : relativeDue(event.startsAt);
  const soon = ongoing || (days >= 0 && days <= 1);
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
      // abre o detalhe: ao fechá-lo, o foco volta para cá (contrato com o page.tsx)
      data-opens-event={event.id}
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
        {/* sem "block": o .ev-title corta na 2ª linha com reticências, e palavra longa quebra */}
        <span className={cx("ev-title", cancelled && "text-muted line-through")}>{event.title}</span>
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
          {/* coluna estreita (celular): a hora vem para junto das pílulas, como no Figma, e o
              título usa a largura toda; a coluna da direita (.ev-when) some. Fora dela, o contrário. */}
          <span className="ev-at">
            {time === "Dia todo" ? "dia todo" : time}, <span className={soon ? "soon" : undefined}>{rel}</span>
          </span>
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
        <span className="ev-time block">{time}</span>
        <span className={cx("ev-rel block", soon && "soon")}>{rel}</span>
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

  // dados na ordem do Figma; evento oficial sem local não ganha "Não informado" (feriado não tem sala)
  const when = eventWhenSummary(event, now);
  const endLabel = eventEndLabel(event);
  const location = event.location ?? (official ? null : "Não informado");
  const responsible = official ? "Administração" : (event.teacher?.fullName ?? "Docente");

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
          O aviso aparece aqui no sistema e também chega no seu <span className="whitespace-nowrap">e-mail</span>.
        </p>
      </section>
    );
  }

  // ordem do Figma (Cronograma, agenda e detalhe; Mobile, detalhe): situação, quando, os dados,
  // a descrição e, por último, o lembrete. As ações de quem gerencia ficam entre os dados e o lembrete.
  return (
    <div>
      <div className={cx("flex flex-wrap items-center gap-2", cornerSpace && "min-h-[38px] pr-12")}>
        <span className={cx("pill", meta.tint)}>{meta.short}</span>
        <StatusPill event={event} showScheduled />
        {showsOfficialPill(event) ? <OfficialPill /> : null}
      </div>
      {/* wrap-anywhere: palavra ou link sem espaço quebra na largura do detalhe, sem alargar o painel */}
      <h2
        ref={titleRef}
        tabIndex={-1}
        className={cx("disp mt-3 text-[26px] font-bold leading-tight wrap-anywhere", cancelled && "text-muted line-through")}
      >
        {event.title}
      </h2>
      <p className="sub wrap-anywhere">{sourceText(event)}</p>

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
      {when ? (
        <p className={cx("callout mt-4 items-center", when.tone)}>
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b className="font-bold">{when.head}</b>
            {when.tail ? `, ${when.tail}` : null}
          </span>
        </p>
      ) : null}

      <dl className="info mt-5">
        <InfoLine icon={CalendarDays} label="Início" value={eventStartLabel(event)} />
        {endLabel ? <InfoLine icon={Clock} label="Término" value={endLabel} /> : null}
        {/* o dd do InfoLine (ui.tsx) já quebra palavra longa; o span do Local repete, sem break-words, que o anularia */}
        {location ? <InfoLine icon={MapPin} label="Local" value={<span className="wrap-anywhere">{location}</span>} /> : null}
        {event.subject?.name ? <InfoLine icon={BookOpen} label="Disciplina" value={event.subject.name} /> : null}
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Toda a instituição"} />
        <InfoLine icon={UserRound} label="Responsável" value={responsible} />
        {event.points !== null ? (
          <InfoLine icon={Award} label="Pontuação" value={`${event.points.toLocaleString("pt-BR")} pts (informativa)`} />
        ) : null}
      </dl>

      {event.description ? <p className="callout past mt-5 whitespace-pre-line wrap-anywhere">{event.description}</p> : null}

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
