"use client";

import {
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  Check,
  CircleCheck,
  History,
  Loader2,
  Mail,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import {
  countText,
  cx,
  dateParts,
  formatRelativeWhen,
  formatShortDate,
  formatTime,
  groupByWeek,
  isWholeDay,
  relativeDue,
  startOfDay,
} from "@/lib/format";
import { categoryMeta, reminderOffsetLabel, reminderOptions, statusMeta } from "@/lib/meta";
import type { AcademicEvent, Category, Reminder, UserRole } from "@/lib/types";
import { Pager, usePaged } from "./pager";
import { Select, type SelectOption } from "./select";
import { EmptyState, Switch } from "./ui";

/*
 * Lembretes (rodada 10, visual Pantanal): a tela lista os EVENTOS que importam, cada um com um interruptor de
 * lembrete, e não "lembretes" soltos. Sem cabeçalho de página: em cima, o "Próximo aviso" com a linha do tempo
 * (Agora, E-mail sai, o evento) e quantas avaliações têm lembrete, com o "Lembrar das que faltam"; ao lado, "Como
 * você é avisado" (a antecedência padrão, editada ali mesmo, e onde o aviso chega); embaixo, a lista "Avaliações e
 * eventos" (Próximos e Já avisados), com o selo da data.
 */

/** Linhas por página na lista. */
const PAGE = 8;
/** Relógio da tela: "Aviso hoje, 18:00", as antecedências que já passaram e o que já foi avisado. */
const CLOCK_TICK = 30000;
/** Menor antecedência aceita, em minutos (15). */
const MIN_OFFSET = Math.min(...reminderOptions.map((option) => Number(option.value)));
/** O aviso precisa cair um pouco no futuro (o relógio da tela anda de 30 em 30 s). */
const MARGIN = 60000;
/** A cobertura da faixa olha as avaliações destes próximos dias. */
const COVER_DAYS = 30;
/** Quanto tempo o "Salvo" fica na linha. */
const FLASH_MS = 1500;

type Tab = "next" | "sent";

const isAssessment = (event: AcademicEvent) => event.category === "exam" || event.category === "assignment";
const isVoid = (event?: AcademicEvent | null) => event?.status === "cancelled" || event?.status === "completed";
const startOf = (event: AcademicEvent) => new Date(event.startsAt).getTime();

/**
 * Quando o aviso sai (ou saiu), no mesmo formato do toast e do detalhe do evento (formatRelativeWhen): "hoje às
 * 18:00", "amanhã às 07:30" ou "qua, 25/11, às 18:00". O que saiu ontem fica "ontem às 18:00".
 */
export function sendWhen(value: string, now: number) {
  const days = Math.round((startOfDay(new Date(value)).getTime() - startOfDay(new Date(now)).getTime()) / 86400000);
  return days === -1 ? `ontem às ${formatTime(value)}` : formatRelativeWhen(value, now);
}

/* ---------------- antecedência padrão e canais: os mesmos no perfil e em Lembretes ---------------- */

/** Dica da antecedência padrão (a mesma no perfil e em Lembretes). */
export const DEFAULT_REMINDER_HINT = "Vale para os lembretes novos.";

/** Opções da antecedência padrão: as 10 de sempre, mais a de agora quando não for uma delas. */
export function defaultReminderOptions(...keep: number[]): SelectOption[] {
  const values = [...new Set([...reminderOptions.map((option) => Number(option.value)), ...keep])]
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
    .sort((a, b) => a - b);
  return values.map((minutes) => ({ value: String(minutes), label: reminderOffsetLabel(minutes) }));
}

/** "Antecedência padrão": o mesmo Select no perfil (salva com o formulário) e em Lembretes (salva na hora). */
export function DefaultReminderSelect({
  value,
  keep,
  hint = DEFAULT_REMINDER_HINT,
  buttonRef,
  onChange,
}: {
  value: number;
  /** Antecedência que continua na lista mesmo fora das de sempre (a de quando o perfil abriu). */
  keep?: number;
  hint?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onChange: (minutes: number) => void;
}) {
  return (
    <Select
      className="lb-default"
      label="Antecedência padrão"
      hint={hint}
      value={String(value)}
      options={defaultReminderOptions(value, ...(keep ? [keep] : []))}
      searchable={false}
      buttonRef={buttonRef}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

/** "Onde o aviso chega": no sistema e no e-mail (o mesmo texto no perfil e em Lembretes). */
export function ReminderChannels({ email }: { email?: string | null }) {
  return (
    <ul className="lb-channels">
      <li>
        <span className="lb-ch-ico is-app" aria-hidden>
          <Bell className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <b>No sistema</b>
          <small>O aviso aparece no Painel e em Lembretes.</small>
        </span>
        <span className="lb-ch-ok">
          <Check aria-label="Ligado" />
        </span>
      </li>
      <li>
        <span className="lb-ch-ico is-mail" aria-hidden>
          <Mail className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <b>No e-mail</b>
          <small className="wrap-anywhere">{email || "No e-mail da sua conta."}</small>
        </span>
        <span className="lb-ch-ok">
          <Check aria-label="Ligado" />
        </span>
      </li>
    </ul>
  );
}

/** Ao lado do selo de data: "18:00, amanhã"; dia todo: "Dia todo, em 40 dias"; fora do ano, com a data inteira. */
function eventWhen(event: AcademicEvent) {
  const whole = isWholeDay(event.startsAt, event.endsAt);
  if (new Date(event.startsAt).getFullYear() !== new Date().getFullYear()) {
    return `${formatShortDate(event.startsAt)}, ${whole ? "dia todo" : formatTime(event.startsAt)}`;
  }
  return `${whole ? "Dia todo" : formatTime(event.startsAt)}, ${relativeDue(event.startsAt)}`;
}

/** Hora em que o aviso sai com esta antecedência. */
function sendAtFor(event: AcademicEvent, minutes: number) {
  return startOf(event) - minutes * 60000;
}

/** A maior antecedência, até a padrão, cujo aviso ainda cai no futuro (a mesma conta da página). */
function bestOffset(event: AcademicEvent, preferred: number, now: number) {
  const valid = [...new Set([...reminderOptions.map((option) => Number(option.value)), preferred])]
    .filter((minutes) => minutes >= MIN_OFFSET && minutes <= preferred && sendAtFor(event, minutes) > now + MARGIN)
    .sort((a, b) => b - a);
  return valid[0] ?? null;
}

/** O evento ainda aceita lembrete (o de 15 minutos ainda cai no futuro). */
function acceptsReminder(event: AcademicEvent, now: number) {
  return !isVoid(event) && sendAtFor(event, MIN_OFFSET) > now + MARGIN;
}

/** Selo de data: "SEG / 23" (o mês fica no título do grupo). */
export function DateBadge({ value, now }: { value: string; now: number }) {
  const parts = dateParts(value);
  const today = startOfDay(new Date(value)).getTime() === startOfDay(new Date(now)).getTime();
  return (
    <span className={cx("dbadge lb-date", today && "today")} aria-hidden>
      <small>{parts.weekday}</small>
      <b>{parts.day}</b>
    </span>
  );
}

/** Opções do menu de antecedência, cada uma com a hora em que o aviso chega ("qua, 18:00") ou "já passou". */
function offsetOptions(event: AcademicEvent, current: number | null, now: number): SelectOption[] {
  const values = [...new Set([...reminderOptions.map((option) => Number(option.value)), ...(current ? [current] : [])])].sort(
    (a, b) => a - b
  );
  return values.map((minutes) => {
    const at = sendAtFor(event, minutes);
    const late = at <= now + MARGIN && minutes !== current;
    return {
      value: String(minutes),
      label: reminderOffsetLabel(minutes),
      count: late ? "já passou" : sendWhen(new Date(at).toISOString(), now),
      disabled: late,
    };
  });
}

/** "da prova", "do trabalho" ou "do evento" (depois de "1 dia antes"). */
function eventNoun(event: AcademicEvent) {
  return event.category === "exam" ? "da prova" : event.category === "assignment" ? "do trabalho" : "do evento";
}

/** "seg, 23/11, 18:00" ou "seg, 23/11, dia todo": quando o evento é, no ponto final da linha do tempo. */
function eventPoint(event: AcademicEvent) {
  return `${formatShortDate(event.startsAt)}, ${isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt)}`;
}

/**
 * Linha do tempo do próximo aviso: Agora, E-mail sai e o evento. O envelope fica na proporção do tempo; o CSS segura
 * ele longe das pontas (lembretes.css, .lb-tl), para os três rótulos não se encostarem. Sem aviso agendado
 * ("example"), ela mostra como o aviso funciona, apagada e sem animação: o e-mail sai com a antecedência padrão antes
 * da prova ou do trabalho.
 */
function ReminderTimeline({
  now,
  sendAt,
  event,
  example,
}: {
  now: number;
  sendAt?: string;
  event?: AcademicEvent | null;
  /** Sem aviso agendado: os rótulos do exemplo (a antecedência padrão e o nome do ponto final). */
  example?: { offset: string; end: string };
}) {
  let ratio = 0.62;
  if (!example && sendAt && event) {
    const span = Math.max(1, startOf(event) - now);
    ratio = (new Date(sendAt).getTime() - now) / span;
  }
  const point = Math.min(96, Math.max(4, ratio * 100));
  const meta = event ? categoryMeta[event.category] : null;
  return (
    <ol
      className={cx("lb-tl", example && "is-example")}
      style={{ "--p": `${point.toFixed(1)}%` } as CSSProperties}
      aria-label={example ? "Como o aviso funciona" : "Linha do tempo do aviso"}
    >
      <li className="lb-tl-track" aria-hidden>
        <i />
      </li>
      <li className="lb-tl-pt is-now">
        <span className="lb-tl-dot" aria-hidden />
        <b>Agora</b>
        <small className="tnum">hoje, {formatTime(new Date(now).toISOString())}</small>
      </li>
      <li className="lb-tl-pt is-send">
        <span className="lb-tl-env" aria-hidden>
          <Mail />
        </span>
        <b>E-mail sai</b>
        <small className="tnum">{example ? example.offset : sendAt ? sendWhen(sendAt, now) : ""}</small>
      </li>
      <li className="lb-tl-pt is-end">
        <span className={cx("lb-tl-dot", meta?.accent)} aria-hidden />
        <b>{example ? example.end : (meta?.short ?? "Evento")}</b>
        <small className="tnum">{example ? "na data marcada" : event ? eventPoint(event) : ""}</small>
      </li>
    </ol>
  );
}

type RowProps = {
  event: AcademicEvent;
  reminder: Reminder | null;
  now: number;
  /** Posição na lista (a entrada em cascata das linhas). */
  order: number;
  defaultMinutes: number;
  busy: boolean;
  flash: boolean;
  /** Ligado na tela antes de a página confirmar (o interruptor responde no clique). */
  optimistic?: boolean;
  onToggle: (on: boolean) => void;
  onPick: (minutes: number) => void;
  onRemove: () => void;
  onOpen: () => void;
};

/**
 * Linha de evento: selo da data, título (abre o evento) com a categoria e quando é, quando o aviso chega, a
 * antecedência (menu próprio) e o interruptor. Evento cancelado ou concluído: "O aviso não sai mais" e Remover.
 */
function EventRow({ event, reminder, now, order, defaultMinutes, busy, flash, optimistic, onToggle, onPick, onRemove, onOpen }: RowProps) {
  const meta = categoryMeta[event.category];
  const voided = isVoid(event);
  const status = voided ? statusMeta[event.status] : null;
  const on = optimistic ?? Boolean(reminder);
  const sent = Boolean(reminder && (reminder.sentAt || new Date(reminder.sendAt).getTime() <= now));
  const open = acceptsReminder(event, now);
  // antecedência mostrada: a do lembrete ou, desligado, a que ele teria (a padrão, ou a maior que ainda dá)
  const shown = reminder?.offsetMinutes ?? bestOffset(event, defaultMinutes, now) ?? MIN_OFFSET;
  const canPick = !voided && !sent && open;

  let aviso;
  if (busy) {
    aviso = (
      <span className="lb-aviso is-busy" role="status">
        <Loader2 className="animate-spin" aria-hidden />
        Salvando
      </span>
    );
  } else if (flash) {
    aviso = (
      <span className="lb-aviso is-ok" role="status">
        <Check aria-hidden />
        Salvo
      </span>
    );
  } else if (voided && !sent) {
    aviso = <span className="lb-aviso is-off">O aviso não sai mais</span>;
  } else if (reminder && sent) {
    aviso = (
      <span className="lb-aviso is-sent">
        <Check aria-hidden />
        Avisado {sendWhen(reminder.sentAt ?? reminder.sendAt, now)}
      </span>
    );
  } else if (reminder && on) {
    aviso = (
      <span className="lb-aviso">
        <Mail aria-hidden />
        <span>
          Aviso <b>{sendWhen(reminder.sendAt, now)}</b>
        </span>
      </span>
    );
  } else if (!open) {
    aviso = <span className="lb-aviso is-off">Começa em menos de 15 minutos</span>;
  } else {
    aviso = (
      <span className="lb-aviso is-off">
        <BellOff aria-hidden />
        Sem lembrete
      </span>
    );
  }

  return (
    <li
      className={cx("lb-row", on && !voided && "is-on", voided && "is-void")}
      style={{ "--r": Math.min(order, 10) } as CSSProperties}
      data-event={event.id}
    >
      <DateBadge value={event.startsAt} now={now} />
      <div className="lb-main">
        <button className="lb-title" onClick={onOpen} type="button">
          <span className={cx("line-clamp-2 wrap-anywhere", event.status === "cancelled" && "line-through")}>{event.title}</span>
        </button>
        <p className="lb-meta">
          <span className={cx("cat", meta.tint)}>{meta.short}</span>
          {status ? <span className={cx("pill", status.pill)}>{status.label}</span> : null}
          <span className="tnum">{eventWhen(event)}</span>
        </p>
      </div>
      <div className="lb-when">{aviso}</div>
      <div className="lb-offset">
        {canPick ? (
          <Select
            className={cx(!on && "is-off")}
            size="sm"
            ariaLabel={`Antecedência do aviso de ${event.title}`}
            value={String(shown)}
            options={offsetOptions(event, reminder?.offsetMinutes ?? null, now)}
            searchable={false}
            menuMinWidth={360}
            onChange={(value) => {
              if (!busy) {
                onPick(Number(value));
              }
            }}
          />
        ) : reminder && !voided ? (
          <span className="lb-offset-txt">{reminderOffsetLabel(reminder.offsetMinutes)}</span>
        ) : null}
      </div>
      <div className="lb-toggle">
        {voided ? (
          reminder ? (
            <button className="btn btn-g btn-sm" aria-label={`Remover o lembrete de ${event.title}`} onClick={onRemove} type="button">
              Remover
            </button>
          ) : null
        ) : (
          <Switch
            checked={on}
            disabled={!reminder && !open}
            label={<span className="sr-only">Lembrete de {event.title}</span>}
            onChange={(next) => {
              if (!busy) {
                onToggle(next);
              }
            }}
          />
        )}
      </div>
    </li>
  );
}

/** Linha do histórico: o aviso que já saiu, quando saiu e se ainda está no Painel. */
function SentRow({
  reminder,
  now,
  order,
  live,
  onDismiss,
  onOpen,
}: {
  reminder: Reminder;
  now: number;
  order: number;
  live: boolean;
  onDismiss?: () => void;
  onOpen: () => void;
}) {
  const event = reminder.academicEvent ?? null;
  const meta = event ? categoryMeta[event.category] : null;
  const title = event?.title ?? `Evento #${reminder.academicEventId}`;
  return (
    <li className="lb-row is-hist" style={{ "--r": Math.min(order, 10) } as CSSProperties}>
      {event ? <DateBadge value={event.startsAt} now={now} /> : <span className="dbadge lb-date" aria-hidden />}
      <div className="lb-main">
        <button className="lb-title" onClick={onOpen} type="button">
          <span className="line-clamp-2 wrap-anywhere">{title}</span>
        </button>
        {event && meta ? (
          <p className="lb-meta">
            <span className={cx("cat", meta.tint)}>{meta.short}</span>
            <span className="tnum">{eventWhen(event)}</span>
          </p>
        ) : null}
      </div>
      <div className="lb-when">
        <span className="lb-aviso is-sent">
          <Check aria-hidden />
          Avisado {sendWhen(reminder.sentAt ?? reminder.sendAt, now)}
        </span>
      </div>
      <div className="lb-offset">
        {live ? (
          <span className="stat blue">Avisando agora</span>
        ) : (
          <span className="lb-offset-txt">{reminderOffsetLabel(reminder.offsetMinutes)}</span>
        )}
      </div>
      <div className="lb-toggle">
        {live && onDismiss ? (
          <button className="btn btn-g btn-sm" aria-label={`Dispensar o aviso de ${title}`} onClick={onDismiss} type="button">
            Dispensar
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function RemindersView({
  avisos,
  defaultReminderMinutes = 1440,
  email,
  reminders,
  role = "student",
  saving,
  studentName,
  upcomingEvents,
  onChangeOffset,
  onClearMany,
  onDelete,
  onDismissAviso,
  onOpenCalendar,
  onOpenEvent,
  onQuickReminder,
  onRemindMany,
  onSaveDefault,
}: {
  /** Lembretes cuja hora chegou e ainda não foram dispensados. */
  avisos?: Reminder[];
  /** Antecedência padrão do usuário (os lembretes novos). */
  defaultReminderMinutes?: number;
  /** Endereço onde o e-mail do aviso chega. */
  email?: string;
  reminders: Reminder[];
  role?: UserRole;
  saving: boolean;
  /** Responsável: o nome do estudante (o subtítulo fala da agenda dele). */
  studentName?: string | null;
  upcomingEvents?: AcademicEvent[];
  onChangeOffset?: (reminder: Reminder, minutes: number) => void | Promise<unknown>;
  /** Remove vários de uma vez (os de eventos cancelados ou concluídos), com Desfazer. */
  onClearMany?: (reminders: Reminder[]) => void | Promise<unknown>;
  onDelete: (reminder: Reminder) => void | Promise<unknown>;
  onDismissAviso?: (reminderId: number) => void;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  onOpenEvent: (id: number) => void;
  /** Liga o lembrete do evento (minutes: a antecedência escolhida; sem ela, a padrão). */
  onQuickReminder?: (event: AcademicEvent, minutes?: number) => void | Promise<unknown>;
  /** Liga o lembrete de vários eventos com a antecedência padrão ("Lembrar das que faltam"). */
  onRemindMany?: (events: AcademicEvent[]) => void | Promise<unknown>;
  /** Salva a antecedência padrão no perfil. */
  onSaveDefault?: (minutes: number) => void | Promise<unknown>;
}) {
  const baseId = useId();
  const listTitleId = `${baseId}-lista`;
  const sideTitleId = `${baseId}-como`;
  const stripTitleId = `${baseId}-faixa`;
  const panelId = `${baseId}-painel`;
  const tabIds: Record<Tab, string> = { next: `${baseId}-aba-proximos`, sent: `${baseId}-aba-avisados` };

  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("next");
  // evento salvando, o "Salvo" de agora e o interruptor ligado ou desligado antes de a página confirmar
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [savingDefault, setSavingDefault] = useState<number | null>(null);

  const listTitleRef = useRef<HTMLHeadingElement>(null);
  const stripTitleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  /* ---------------- listas ---------------- */
  const byEvent = new Map(reminders.map((reminder) => [reminder.academicEventId, reminder]));
  const showAssessments = role !== "admin";
  const seen = new Set<number>();
  const nextEvents: AcademicEvent[] = [];
  for (const event of upcomingEvents ?? []) {
    if (startOf(event) > now && ((showAssessments && isAssessment(event)) || byEvent.has(event.id))) {
      seen.add(event.id);
      nextEvents.push({ ...event, reminder: byEvent.get(event.id) ?? null });
    }
  }
  // lembretes de eventos por vir que a lista ainda não tem (cancelados e concluídos saem de upcomingEvents)
  for (const reminder of reminders) {
    const event = reminder.academicEvent;
    if (event && !seen.has(event.id) && startOf(event) > now) {
      seen.add(event.id);
      nextEvents.push({ ...event, reminder });
    }
  }
  nextEvents.sort((a, b) => startOf(a) - startOf(b));

  // o aviso já saiu (gravado pelo agendador ou com a hora passada, desde que o evento não tenha sido cancelado antes):
  // vai para "Já avisados" mesmo que o evento tenha sido concluído depois, como toda prova que passa
  const wentOut = (reminder: Reminder) =>
    Boolean(reminder.sentAt) || (new Date(reminder.sendAt).getTime() <= now && reminder.academicEvent?.status !== "cancelled");
  const voided = reminders.filter((reminder) => isVoid(reminder.academicEvent) && !wentOut(reminder));
  const sent = reminders
    .filter(wentOut)
    .sort((a, b) => new Date(b.sentAt ?? b.sendAt).getTime() - new Date(a.sentAt ?? a.sendAt).getTime());
  const liveIds = new Set((avisos ?? []).map((aviso) => aviso.id));

  const pagedNext = usePaged(nextEvents, PAGE, "next");
  const pagedSent = usePaged(sent, PAGE, "sent");

  // próximo aviso: o primeiro lembrete ativo cujo aviso ainda vai sair
  const nextAviso =
    reminders
      .filter((reminder) => reminder.enabled && !isVoid(reminder.academicEvent) && new Date(reminder.sendAt).getTime() > now)
      .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime())[0] ?? null;

  // cobertura: as avaliações dos próximos 30 dias que ainda aceitam lembrete
  const horizon = now + COVER_DAYS * 86400000;
  const covered = nextEvents.filter((event) => isAssessment(event) && !isVoid(event) && startOf(event) <= horizon);
  const coverTotal = covered.filter((event) => byEvent.has(event.id) || acceptsReminder(event, now)).length;
  const coverDone = covered.filter((event) => byEvent.has(event.id)).length;
  const missing = covered.filter((event) => !byEvent.has(event.id) && acceptsReminder(event, now));

  /* ---------------- ações ---------------- */
  function flash(eventId: number) {
    setFlashId(eventId);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), FLASH_MS);
  }

  async function run(eventId: number, task: () => void | Promise<unknown>, nextOn?: boolean) {
    if (busyId !== null || saving) {
      return;
    }
    setBusyId(eventId);
    if (nextOn !== undefined) {
      setOptimistic((current) => ({ ...current, [eventId]: nextOn }));
    }
    let ok = true;
    try {
      // as ações da página devolvem false quando não deu certo (o aviso de erro é delas)
      ok = (await task()) !== false;
    } catch {
      ok = false;
    } finally {
      setBusyId(null);
      setOptimistic((current) => {
        const copy = { ...current };
        delete copy[eventId];
        return copy;
      });
    }
    if (ok) {
      flash(eventId);
    }
  }

  function toggle(event: AcademicEvent, on: boolean) {
    const reminder = byEvent.get(event.id);
    if (on && !reminder && onQuickReminder) {
      void run(event.id, () => onQuickReminder(event), true);
    } else if (!on && reminder) {
      void run(event.id, () => onDelete(reminder), false);
    }
  }

  function pick(event: AcademicEvent, minutes: number) {
    const reminder = byEvent.get(event.id);
    if (reminder) {
      if (minutes !== reminder.offsetMinutes && onChangeOffset) {
        void run(event.id, () => onChangeOffset(reminder, minutes));
      }
    } else if (onQuickReminder) {
      // desligado: escolher a antecedência já liga o lembrete
      void run(event.id, () => onQuickReminder(event, minutes), true);
    }
  }

  function remove(reminder: Reminder) {
    void Promise.resolve(onDelete(reminder)).finally(() => listTitleRef.current?.focus({ preventScroll: true }));
  }

  async function remindMissing() {
    if (!onRemindMany || !missing.length || bulkBusy || saving) {
      return;
    }
    setBulkBusy(true);
    try {
      await onRemindMany(missing);
    } finally {
      setBulkBusy(false);
      // o botão sai quando todas ficam com lembrete: o foco vai para o título da faixa
      window.requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          stripTitleRef.current?.focus({ preventScroll: true });
        }
      });
    }
  }

  async function clearVoided() {
    if (!onClearMany || !voided.length || clearBusy) {
      return;
    }
    setClearBusy(true);
    try {
      await onClearMany(voided);
    } finally {
      setClearBusy(false);
      listTitleRef.current?.focus({ preventScroll: true });
    }
  }

  async function chooseDefault(minutes: number) {
    if (!onSaveDefault || minutes === defaultReminderMinutes || savingDefault !== null) {
      return;
    }
    setSavingDefault(minutes);
    try {
      await onSaveDefault(minutes);
    } finally {
      setSavingDefault(null);
    }
  }

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target: Tab = event.key === "Home" ? "next" : event.key === "End" ? "sent" : tab === "next" ? "sent" : "next";
      setTab(target);
      tabRefs.current.get(target)?.focus();
    }
  }

  /* ---------------- textos por perfil ---------------- */
  const subtitle =
    role === "teacher"
      ? "Avisos para você das provas e entregas das suas turmas."
      : role === "guardian"
        ? `Avisos para você das provas e trabalhos${studentName ? ` de ${studentName}` : ""}.`
        : role === "admin"
          ? "Avisos para você das datas que escolher no cronograma."
          : "Escolha de quais provas e eventos você quer ser avisado e quando.";
  const nextEvent = nextAviso?.academicEvent ?? null;
  // sem aviso agendado, a faixa e a lista são as mesmas de antes; com ele, o título é o evento e a linha do tempo diz o resto
  const hasStrip = Boolean(nextAviso || nextEvents.length);

  /* ---------------- próximo aviso: o evento, a linha do tempo e a cobertura das avaliações ---------------- */
  const strip = (
    <section className="card lb-next anim-in" style={{ "--i": 0 } as CSSProperties} aria-labelledby={stripTitleId}>
      <div className="lb-next-head">
        <div className="min-w-0">
          <p className="lb-kicker">
            <span className="lb-ic is-ipe" aria-hidden>
              <Send />
            </span>
            Próximo aviso
          </p>
          <h2 ref={stripTitleRef} id={stripTitleId} tabIndex={-1} className="lb-next-t wrap-anywhere">
            {nextAviso ? (nextEvent?.title ?? "Evento da sua agenda") : "Nenhum aviso agendado"}
          </h2>
          <p className="lb-next-s">
            {nextAviso ? (
              <>
                O e-mail sai <b className="tnum">{sendWhen(nextAviso.sendAt, now)}</b>,{" "}
                {reminderOffsetLabel(nextAviso.offsetMinutes)}
                {nextEvent ? ` ${eventNoun(nextEvent)}` : ""}.
              </>
            ) : !showAssessments ? (
              "Ligue o lembrete de um evento para ser avisado antes dele."
            ) : coverTotal ? (
              "Ligue o lembrete das provas e trabalhos que vêm aí."
            ) : (
              "Nenhuma avaliação nos próximos 30 dias. As que vêm depois também aceitam lembrete."
            )}
          </p>
        </div>
        {nextEvent ? (
          <button className="link lb-next-link" onClick={() => onOpenEvent(nextEvent.id)} type="button">
            Ver evento
            <ArrowRight aria-hidden />
          </button>
        ) : null}
      </div>

      {nextAviso && nextEvent ? (
        <ReminderTimeline now={now} sendAt={nextAviso.sendAt} event={nextEvent} />
      ) : !nextAviso ? (
        <ReminderTimeline
          now={now}
          example={{
            offset: reminderOffsetLabel(defaultReminderMinutes),
            end: showAssessments ? "Prova ou trabalho" : "Evento",
          }}
        />
      ) : null}

      {showAssessments && coverTotal ? (
        <div className="lb-cover">
          <p className="lb-cover-t">
            <b className="tnum">
              {coverDone}
              <small> de {coverTotal}</small>
            </b>
            <span>
              {coverTotal === 1 ? "avaliação" : "avaliações"} com lembrete nos próximos 30 dias
            </span>
          </p>
          <div
            className="lb-bar"
            role="progressbar"
            aria-label="Avaliações dos próximos 30 dias com lembrete"
            aria-valuemin={0}
            aria-valuemax={coverTotal}
            aria-valuenow={coverDone}
          >
            <span className="bar-grow" style={{ width: `${Math.round((coverDone / coverTotal) * 100)}%` }} />
          </div>
          {missing.length && onRemindMany ? (
            <button
              className="btn btn-p lb-cover-btn"
              aria-busy={bulkBusy || undefined}
              aria-disabled={bulkBusy || saving || undefined}
              onClick={() => void remindMissing()}
              type="button"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
              {missing.length === 1 ? "Lembrar da que falta" : `Lembrar das ${missing.length} que faltam`}
            </button>
          ) : (
            <p className="lb-cover-ok">
              <CircleCheck className="h-4 w-4" aria-hidden />
              Todas com lembrete
            </p>
          )}
        </div>
      ) : null}
    </section>
  );

  /* ---------------- lista ---------------- */
  const groups = groupByWeek(pagedNext.items, new Date(now));
  // posição de cada linha na página (a entrada em cascata segue a lista, de grupo em grupo)
  const rowOrder = new Map(pagedNext.items.map((event, index) => [event.id, index]));
  const nextList = pagedNext.total ? (
    <>
      {groups.map((group) => (
        <div key={group.label} className="lb-group">
          <h3 className="lb-group-h">{group.label}</h3>
          <ul className="lb-list">
            {group.items.map((event) => {
              const reminder = byEvent.get(event.id) ?? null;
              return (
                <EventRow
                  key={event.id}
                  event={event}
                  reminder={reminder}
                  now={now}
                  order={rowOrder.get(event.id) ?? 0}
                  defaultMinutes={defaultReminderMinutes}
                  busy={busyId === event.id}
                  flash={flashId === event.id}
                  optimistic={optimistic[event.id]}
                  onToggle={(on) => toggle(event, on)}
                  onPick={(minutes) => pick(event, minutes)}
                  onRemove={() => reminder && remove(reminder)}
                  onOpen={() => onOpenEvent(event.id)}
                />
              );
            })}
          </ul>
        </div>
      ))}
      <Pager className="lb-pager" paged={pagedNext} noun={["evento", "eventos"]} focusRef={listTitleRef} />
    </>
  ) : (
    // um vazio só: sem nada por vir, a faixa do alto sai e quem fala é este (sem turma também vale: as datas da
    // instituição não são provas nem trabalhos)
    <EmptyState
      icon={Bell}
      text={showAssessments ? "Nenhuma prova ou trabalho por vir" : "Nenhum lembrete ligado"}
      hint={
        showAssessments
          ? "As provas e trabalhos aparecem aqui quando forem marcados."
          : "Os eventos que você escolher no cronograma aparecem aqui."
      }
      action={onOpenCalendar ? { label: "Ver cronograma", onClick: () => onOpenCalendar() } : undefined}
    />
  );

  const sentList = pagedSent.total ? (
    <>
      <ul className="lb-list lb-list-hist">
        {pagedSent.items.map((reminder, index) => (
          <SentRow
            key={reminder.id}
            reminder={reminder}
            now={now}
            order={index}
            live={liveIds.has(reminder.id)}
            onDismiss={onDismissAviso ? () => onDismissAviso(reminder.id) : undefined}
            onOpen={() => onOpenEvent(reminder.academicEventId)}
          />
        ))}
      </ul>
      <Pager className="lb-pager" paged={pagedSent} noun={["aviso", "avisos"]} focusRef={listTitleRef} />
    </>
  ) : (
    <EmptyState icon={History} text="Nenhum aviso saiu ainda" hint="Os avisos que já chegaram ficam aqui." />
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "next", label: "Próximos", count: nextEvents.length },
    { key: "sent", label: "Já avisados", count: sent.length },
  ];

  const listCard = (
    <section className="card lb-card anim-in" style={{ "--i": 2 } as CSSProperties} aria-labelledby={listTitleId}>
      <div className="lb-card-head">
        <div className="lb-card-ttl">
          <span className="lb-ic is-ipe" aria-hidden>
            <BellRing />
          </span>
          <div className="min-w-0">
            <h2 ref={listTitleRef} id={listTitleId} tabIndex={-1} className="lb-h outline-none">
              {showAssessments ? "Avaliações e eventos" : "Seus lembretes"}
            </h2>
            {/* o que era o subtítulo da página: de quem são os avisos (o responsável vê o nome do estudante) */}
            <p className="lb-sub">{subtitle}</p>
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Lista">
          {tabs.map((item) => (
            <button
              key={item.key}
              ref={(node) => {
                if (node) tabRefs.current.set(item.key, node);
                else tabRefs.current.delete(item.key);
              }}
              id={tabIds[item.key]}
              className={cx(tab === item.key && "on")}
              role="tab"
              aria-selected={tab === item.key}
              aria-controls={panelId}
              tabIndex={tab === item.key ? 0 : -1}
              onClick={() => setTab(item.key)}
              onKeyDown={tabKeyDown}
              type="button"
            >
              {item.label} <span className="n">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabIds[tab]} className="lb-panel">
        {tab === "next" ? nextList : sentList}
        {tab === "next" && onOpenCalendar && nextEvents.length ? (
          <p className="lb-more">
            Outro evento? Abra no cronograma e ligue o lembrete.{" "}
            <button className="link" onClick={() => onOpenCalendar()} type="button">
              Ver cronograma
              <ArrowRight aria-hidden />
            </button>
          </p>
        ) : null}
      </div>
      {tab === "next" && voided.length ? (
        <div className="lb-void">
          <p className="min-w-0 flex-1">
            <b>{countText(voided.length, "lembrete de evento cancelado ou concluído", "lembretes de eventos cancelados ou concluídos")}</b>
            <span>{voided.length === 1 ? "O aviso dele não sai mais." : "Os avisos deles não saem mais."}</span>
          </p>
          {onClearMany ? (
            <button
              className="btn btn-s btn-sm"
              aria-busy={clearBusy || undefined}
              aria-disabled={clearBusy || saving || undefined}
              onClick={() => void clearVoided()}
              type="button"
            >
              {clearBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {voided.length === 1 ? "Limpar" : "Limpar todos"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  /* ---------------- lateral ---------------- */
  const side = (
    <section className="card lb-side anim-in" style={{ "--i": 1 } as CSSProperties} aria-labelledby={sideTitleId}>
      <h2 id={sideTitleId} className="lb-h lb-side-t">
        <span className="lb-ic is-brand" aria-hidden>
          <SlidersHorizontal />
        </span>
        Como você é avisado
      </h2>

      <div className="lb-side-grid">
        <div className="lb-side-sel">
          <DefaultReminderSelect
            value={savingDefault ?? defaultReminderMinutes}
            keep={defaultReminderMinutes}
            hint={savingDefault !== null ? "Salvando" : DEFAULT_REMINDER_HINT}
            onChange={(minutes) => void chooseDefault(minutes)}
          />
        </div>
        <div className="lb-side-ch">
          <h3 className="lb-side-h">Onde o aviso chega</h3>
          <ReminderChannels email={email} />
        </div>
      </div>
    </section>
  );

  // sem cabeçalho de página (o nome da tela está no trilho): começa pelo Próximo aviso, com "Como você é avisado" ao
  // lado, e a lista embaixo. Sem aviso agendado e sem nada por vir, a faixa só repetiria o vazio da lista ("Nenhum
  // aviso agendado" em cima de "Nenhuma prova ou trabalho por vir"): ela sai, a lista fica no alto e o "Como você é
  // avisado" desce para baixo dela, na largura toda (sem card esticado com buraco)
  return (
    <div className={cx("lb", hasStrip ? "has-next" : "no-next")}>
      {hasStrip ? strip : null}
      {listCard}
      {side}
    </div>
  );
}
