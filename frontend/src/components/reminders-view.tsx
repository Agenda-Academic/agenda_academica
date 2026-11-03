"use client";

import { ArrowRight, Bell, BellOff, CalendarClock, CalendarDays, Info, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx, formatShortDate, formatShortDateTime, isWholeDay, relativeDue } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel, reminderOptions, statusMeta } from "@/lib/meta";
import type { AcademicEvent, Category, Reminder } from "@/lib/types";
import { AvisosCard, delay } from "./dashboard-bits";
import { Segmented } from "./ui";

type Tab = "pending" | "sent" | "all";

/** "ter, 09/11, 19:00"; "dia todo" só quando o evento não tem horário (começa à meia-noite, sem hora de término). */
function eventWhen(event: AcademicEvent) {
  return isWholeDay(event.startsAt, event.endsAt)
    ? `${formatShortDate(event.startsAt)}, dia todo`
    : formatShortDateTime(event.startsAt);
}

/** Evento cancelado ou concluído: o aviso do lembrete não sai mais (o mesmo texto do detalhe). */
function voidReason(reminder: Reminder) {
  const status = reminder.academicEvent?.status;
  if (status === "cancelled") {
    return "O evento foi cancelado. Seu lembrete não vale mais.";
  }
  if (status === "completed") {
    return "O evento foi concluído. Seu lembrete não vale mais.";
  }
  return null;
}

/** Maior antecedência das opções, até o padrão, cujo aviso ainda cai no futuro. */
function quickOffset(event: AcademicEvent, defaultMinutes: number, now: number) {
  const start = new Date(event.startsAt).getTime();
  const options = reminderOptions.map((option) => Number(option.value)).sort((a, b) => b - a);
  return options.find((minutes) => minutes <= defaultMinutes && start - minutes * 60000 > now) ?? null;
}

function ReminderRow({
  reminder,
  now,
  busy,
  changing,
  offset,
  removeRef,
  onChangeOffset,
  onDelete,
  onOpenEvent,
}: {
  reminder: Reminder;
  now: number;
  busy: boolean;
  changing: boolean;
  /** Antecedência mostrada no select (a escolhida enquanto salva). */
  offset: number;
  removeRef: (node: HTMLButtonElement | null) => void;
  onChangeOffset?: (minutes: number) => void;
  onDelete: () => void;
  onOpenEvent: (id: number) => void;
}) {
  const event = reminder.academicEvent ?? null;
  const meta = event ? categoryMeta[event.category] : null;
  const title = event?.title ?? `Evento #${reminder.academicEventId}`;
  const start = event ? new Date(event.startsAt).getTime() : null;
  const eventAhead = start !== null && start > now;
  const noLonger = voidReason(reminder);
  const status = event && noLonger ? statusMeta[event.status] : null;
  const StatusIcon = status?.icon;
  const options = reminderOptions.some((option) => Number(option.value) === offset)
    ? reminderOptions
    : [...reminderOptions, { value: String(offset), label: reminderOffsetLabel(offset) }].sort((a, b) => Number(a.value) - Number(b.value));

  return (
    <li className="rounded-2xl border border-line-2 bg-white p-3.5">
      <div className="grid gap-3 @min-[700px]:grid-cols-[minmax(0,1fr)_auto] @min-[700px]:items-center @min-[700px]:gap-6">
        <div className="min-w-0">
          <div className="flex items-start gap-2.5">
            {meta ? <span className={cx("pill mt-px shrink-0", meta.tint)}>{meta.short}</span> : null}
            {status && StatusIcon ? (
              <span className={cx("pill mt-px shrink-0", status.pill)}>
                <StatusIcon className="h-3 w-3" aria-hidden />
                {status.label}
              </span>
            ) : null}
            {event ? (
              <button
                className="min-w-0 flex-1 rounded-md text-left text-[15px] font-bold leading-snug underline-offset-4 hover:text-brand-ink hover:underline"
                onClick={() => onOpenEvent(event.id)}
                type="button"
              >
                <span className={cx("line-clamp-2", event.status === "cancelled" && "text-muted line-through")}>
                  {event.title}
                </span>
              </button>
            ) : (
              <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{title}</span>
            )}
          </div>
          <div className="ev-meta">
            {event ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Evento {eventWhen(event)} ({relativeDue(event.startsAt)})
              </span>
            ) : null}
            {noLonger ? (
              <span className="inline-flex items-center gap-1.5">
                <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {noLonger}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Aviso: {formatShortDateTime(reminder.sendAt)} ({reminderOffsetLabel(reminder.offsetMinutes)})
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* evento cancelado ou concluído: não há mais aviso para adiantar ou atrasar */}
          {onChangeOffset && eventAhead && !noLonger ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-3">
              Avisar
              <select
                className="input !min-h-10 h-10 w-auto py-0 pl-3 text-sm"
                aria-label={`Antecedência do aviso de ${title}`}
                value={String(offset)}
                disabled={busy || changing}
                onChange={(change) => onChangeOffset(Number(change.target.value))}
              >
                {options.map((option) => {
                  const minutes = Number(option.value);
                  // antecedência que já passou não serve para um aviso novo
                  const late = start !== null && start - minutes * 60000 <= now && minutes !== offset;
                  return (
                    <option key={option.value} value={option.value} disabled={late}>
                      {option.label}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          {changing ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-sm text-ink-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Salvando
            </span>
          ) : null}
          <button
            ref={removeRef}
            className="link min-h-10 px-1 text-[var(--danger)] underline-offset-4 hover:text-[var(--danger)] hover:underline"
            aria-label={`Remover lembrete de ${title}`}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) {
                onDelete();
              }
            }}
            type="button"
          >
            Remover
          </button>
        </div>
      </div>
    </li>
  );
}

export function RemindersView({
  reminders,
  saving,
  avisos,
  defaultReminderMinutes,
  upcomingEvents,
  onChangeOffset,
  onDelete,
  onDismissAviso,
  onOpenCalendar,
  onOpenEvent,
  onOpenProfile,
  onQuickReminder,
}: {
  reminders: Reminder[];
  saving: boolean;
  /** Lembretes cuja hora chegou e ainda não foram dispensados. */
  avisos?: Reminder[];
  /** Antecedência padrão do usuário (rótulo do "Lembrar 1 dia antes"). */
  defaultReminderMinutes?: number;
  upcomingEvents?: AcademicEvent[];
  onChangeOffset?: (reminder: Reminder, minutes: number) => void | Promise<unknown>;
  onDelete: (reminder: Reminder) => void;
  onDismissAviso?: (reminderId: number) => void;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  onOpenEvent: (id: number) => void;
  onOpenProfile?: () => void;
  onQuickReminder?: (event: AcademicEvent) => void | Promise<unknown>;
}) {
  const [tab, setTab] = useState<Tab>("pending");
  const [now, setNow] = useState(() => Date.now());
  // antecedência escolhida enquanto a troca salva: { de, para }
  const [pending, setPending] = useState<Record<number, { from: number; to: number }>>({});
  const [quickId, setQuickId] = useState<number | null>(null);
  // quando a página termina de salvar, some o "Salvando" (mesmo se a troca falhou)
  const [wasSaving, setWasSaving] = useState(saving);
  if (wasSaving !== saving) {
    setWasSaving(saving);
    if (!saving) {
      setPending({});
      setQuickId(null);
    }
  }

  const titleRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const removing = useRef<{ id: number; order: number[] } | null>(null);

  // o que já chegou muda de grupo sem recarregar a página
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const byTime = (a: Reminder, b: Reminder) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime();
  // lembrete de evento cancelado ou concluído não avisa mais: fica fora das contas de aviso (como no Painel)
  const voided = reminders.filter((reminder) => voidReason(reminder) !== null).sort(byTime);
  const live = reminders.filter((reminder) => voidReason(reminder) === null);
  const upcoming = live.filter((reminder) => new Date(reminder.sendAt).getTime() > now).sort(byTime);
  // já avisados: a hora do aviso passou (sentAt não é gravado hoje)
  const past = live.filter((reminder) => new Date(reminder.sendAt).getTime() <= now).sort((a, b) => byTime(b, a));
  const scheduled = upcoming.filter((reminder) => reminder.enabled);
  const next = scheduled[0] ?? null;
  const groups =
    tab === "pending"
      ? [{ label: null, items: upcoming }]
      : tab === "sent"
        ? [{ label: null, items: past }]
        : [
            { label: "Agendados", items: upcoming },
            { label: "Já avisados", items: past },
            { label: "Eventos cancelados ou concluídos", items: voided },
          ].filter((group) => group.items.length);
  const visible = groups.flatMap((group) => group.items);
  const shownAvisos = avisos ?? [];
  // abas: no celular vão sem a contagem e com o nome curto, para as três caberem numa linha
  const tabs: Array<{ id: Tab; label: string; short: string; count: number }> = [
    { id: "pending", label: "Agendados", short: "Agendados", count: upcoming.length },
    { id: "sent", label: "Já avisados", short: "Avisados", count: past.length },
    { id: "all", label: "Todos", short: "Todos", count: reminders.length },
  ];

  const reminderEventIds = new Set(reminders.map((reminder) => reminder.academicEventId));
  const suggestions = (upcomingEvents ?? [])
    .filter(
      (event) =>
        (event.category === "exam" || event.category === "assignment") &&
        event.status !== "cancelled" &&
        !reminderEventIds.has(event.id) &&
        !event.reminder &&
        new Date(event.startsAt).getTime() > now
    )
    .slice(0, 3);

  // depois de remover, o foco vai para o próximo "Remover" (ou para o título da lista)
  useEffect(() => {
    const target = removing.current;
    if (!target || reminders.some((reminder) => reminder.id === target.id)) {
      return;
    }
    removing.current = null;
    const at = target.order.indexOf(target.id);
    const rest = target.order.filter((id) => id !== target.id && removeButtons.current.has(id));
    const nextId = rest[Math.min(at, rest.length - 1)];
    (nextId !== undefined ? removeButtons.current.get(nextId) : titleRef.current)?.focus();
  }, [reminders]);

  // terminou de salvar e o lembrete continua na lista: a remoção falhou, o foco fica onde está
  useEffect(() => {
    if (!saving) {
      removing.current = null;
    }
  }, [saving]);

  function clearPending(id: number, minutes: number) {
    setPending((current) => {
      if (current[id]?.to !== minutes) {
        return current;
      }
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
  }

  async function changeOffset(reminder: Reminder, minutes: number) {
    if (!onChangeOffset || minutes === reminder.offsetMinutes) {
      return;
    }
    setPending((current) => ({ ...current, [reminder.id]: { from: reminder.offsetMinutes, to: minutes } }));
    const result = onChangeOffset(reminder, minutes);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      try {
        await result;
      } finally {
        clearPending(reminder.id, minutes);
      }
    } else {
      // sem promessa: o "Salvando" some quando a página termina de salvar ou, no máximo, em 10 s
      window.setTimeout(() => clearPending(reminder.id, minutes), 10000);
    }
  }

  async function quickRemind(event: AcademicEvent) {
    if (!onQuickReminder || quickId !== null || saving) {
      return;
    }
    setQuickId(event.id);
    const result = onQuickReminder(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      try {
        await result;
      } finally {
        setQuickId(null);
      }
    } else {
      window.setTimeout(() => setQuickId((current) => (current === event.id ? null : current)), 10000);
    }
  }

  // sem lembrete agendado, o vazio da lista já diz isso
  const summary = next
    ? `${scheduled.length === 1 ? "1 lembrete agendado" : `${scheduled.length} lembretes agendados`}. Próximo aviso: ${formatShortDateTime(next.sendAt)}, ${
        next.academicEvent?.title ?? `Evento #${next.academicEventId}`
      }.`
    : null;

  const suggestionBlock =
    suggestions.length && onQuickReminder ? (
      <div className="mt-4 w-full max-w-xl text-left">
        <p className="text-sm font-bold text-ink-2">Próximas provas e trabalhos</p>
        <ul className="mt-2 grid gap-2">
          {suggestions.map((event) => {
            const minutes = defaultReminderMinutes ? quickOffset(event, defaultReminderMinutes, now) : null;
            const label = minutes ? `Lembrar ${reminderOffsetLabel(minutes)}` : "Ativar lembrete";
            const meta = categoryMeta[event.category];
            return (
              <li key={event.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line-2 bg-white p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-[15px] font-bold leading-snug">{event.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span className={cx("pill", meta.tint)}>{meta.short}</span>
                    {eventWhen(event)}
                  </p>
                </div>
                <button
                  className="btn btn-s btn-sm"
                  aria-label={`${label}: ${event.title}`}
                  aria-busy={quickId === event.id || undefined}
                  aria-disabled={quickId !== null || saving || undefined}
                  onClick={() => void quickRemind(event)}
                  type="button"
                >
                  {quickId === event.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bell className="h-3.5 w-3.5" aria-hidden />}
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ) : onOpenCalendar ? (
      <button className="btn btn-s mt-3" onClick={() => onOpenCalendar()} type="button">
        <CalendarDays className="h-4 w-4" aria-hidden />
        Abrir cronograma
      </button>
    ) : null;

  const empty = !reminders.length ? (
    <div className="empty-inline">
      <span className="empty-ico">
        <Bell className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold text-ink">Nenhum lembrete ainda.</p>
      <p className="max-w-md text-sm leading-5 text-muted">Abra uma prova ou um trabalho e escolha quando quer ser avisado.</p>
      {suggestionBlock}
    </div>
  ) : !visible.length ? (
    <div className="empty-inline">
      <p className="text-[15px] font-bold text-ink">{tab === "sent" ? "Nenhum aviso chegou ainda." : "Nenhum lembrete agendado."}</p>
      <p className="max-w-md text-sm leading-5 text-muted">
        {tab === "sent" ? "Depois da hora marcada, o lembrete passa para esta aba." : "Ative um lembrete numa prova ou num trabalho."}
      </p>
      {tab !== "sent" ? suggestionBlock : null}
    </div>
  ) : null;

  return (
    <div className="grid gap-5">
      {/* o mesmo bloco de avisos do Painel */}
      <AvisosCard
        avisos={shownAvisos}
        events={upcomingEvents}
        fallbackFocus={() => titleRef.current}
        onDismiss={onDismissAviso}
        onOpen={onOpenEvent}
      />

      <section className="card pad rise" style={delay(1)} aria-label="Meus lembretes">
        <div className="head">
          <div className="min-w-0">
            <h2 ref={titleRef} tabIndex={-1} className="h2 outline-none">
              Meus lembretes
            </h2>
            {summary ? <p className="sub">{summary}</p> : null}
          </div>
          <Segmented label="Mostrar">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={cx(tab === item.id && "on")}
                aria-label={`${item.label} (${item.count})`}
                aria-pressed={tab === item.id}
                onClick={() => setTab(item.id)}
                type="button"
              >
                <span className="@max-[360px]:hidden">
                  {item.label} ({item.count})
                </span>
                <span className="@min-[360px]:hidden">{item.short}</span>
              </button>
            ))}
          </Segmented>
        </div>

        {/* a mesma frase já está no bloco de avisos quando há algum */}
        {!shownAvisos.length ? (
          <p className="mt-3 flex items-start gap-2 text-sm leading-5 text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Na hora marcada, o aviso aparece no Painel e aqui em Lembretes. O envio por e-mail é o próximo passo.</span>
          </p>
        ) : null}

        <div key={tab} className="pop mt-4 grid gap-4">
          {groups.map((group) =>
            group.items.length ? (
              <div key={group.label ?? "lista"}>
                {group.label ? <h3 className="ev-group">{group.label}</h3> : null}
                <ul className="grid gap-2.5">
                  {group.items.map((reminder) => {
                    const change = pending[reminder.id];
                    const offset = change && change.from === reminder.offsetMinutes ? change.to : reminder.offsetMinutes;
                    return (
                      <ReminderRow
                        key={reminder.id}
                        reminder={reminder}
                        now={now}
                        busy={saving}
                        changing={Boolean(change && change.from === reminder.offsetMinutes)}
                        offset={offset}
                        removeRef={(node) => {
                          if (node) {
                            removeButtons.current.set(reminder.id, node);
                          } else {
                            removeButtons.current.delete(reminder.id);
                          }
                        }}
                        onChangeOffset={onChangeOffset ? (minutes) => void changeOffset(reminder, minutes) : undefined}
                        onDelete={() => {
                          removing.current = { id: reminder.id, order: visible.map((item) => item.id) };
                          onDelete(reminder);
                        }}
                        onOpenEvent={onOpenEvent}
                      />
                    );
                  })}
                </ul>
              </div>
            ) : null
          )}
          {empty}
        </div>

        {onOpenProfile ? (
          <button className="link mt-4 min-h-10" onClick={onOpenProfile} type="button">
            Alterar antecedência padrão
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        ) : null}
      </section>
    </div>
  );
}
