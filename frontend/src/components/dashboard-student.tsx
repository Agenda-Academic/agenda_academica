"use client";

import { ArrowRight, Bell, BellRing, BookOpen, CalendarDays, Target, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { cx, formatShortDateTime } from "@/lib/format";
import { allCategories, reminderOffsetLabel, reminderOptions } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Dashboard, Reminder } from "@/lib/types";
import {
  AvisosCard,
  CategoryBreakdown,
  EventList,
  InsightTile,
  NextEventHero,
  WeekSpark,
  calendarUpcomingCount,
  dateChip,
  delay,
  type CalendarFilter,
} from "./dashboard-bits";
import { EmptyState, SectionTitle } from "./ui";

const DAY = 24 * 60 * 60 * 1000;

/** Maior antecedência que ainda dá tempo de avisar, até a padrão da pessoa. */
function quickOffset(event: AcademicEvent, defaultMinutes: number, now: number) {
  const start = new Date(event.startsAt).getTime();
  const options = [defaultMinutes, ...reminderOptions.map((option) => Number(option.value))]
    .filter((minutes) => minutes <= defaultMinutes)
    .sort((a, b) => b - a);
  return options.find((minutes) => start - minutes * 60000 > now) ?? null;
}

export function StudentDashboard({
  avisos,
  context,
  defaultReminderMinutes = 1440,
  events,
  reminders,
  savingReminder,
  upcomingEvents,
  onDismissAviso,
  onOpenCalendar,
  onOpenReminders,
  onQuickReminder,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /** Mantido por compatibilidade: os números saem dos próprios eventos. */
  dashboard?: Dashboard | null;
  defaultReminderMinutes?: number;
  events: AcademicEvent[];
  reminders: Reminder[];
  /** Algum lembrete está sendo salvo (o botão do destaque mostra o giro até terminar). */
  savingReminder?: boolean;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  onOpenCalendar: (filter?: CalendarFilter) => void;
  onOpenReminders: () => void;
  /** Cria o lembrete do destaque com a antecedência padrão, sem sair do Painel. Com promessa, o giro dura até ela terminar. */
  onQuickReminder?: (event: AcademicEvent) => void | Promise<unknown>;
  onSelect: (id: number) => void;
}) {
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  // evento do destaque cujo lembrete está sendo criado
  const [quickId, setQuickId] = useState<number | null>(null);
  // quando a página termina de salvar, some o giro (mesmo se deu erro)
  const [wasSaving, setWasSaving] = useState(Boolean(savingReminder));
  if (wasSaving !== Boolean(savingReminder)) {
    setWasSaving(Boolean(savingReminder));
    if (!savingReminder) {
      setQuickId(null);
    }
  }
  // sem promessa nem aviso da página, o giro some sozinho em 10 s
  useEffect(() => {
    if (quickId === null) {
      return;
    }
    const timer = window.setTimeout(() => setQuickId(null), 10000);
    return () => window.clearTimeout(timer);
  }, [quickId]);

  const nextEvent = upcomingEvents[0] ?? null;
  // todos os números do Painel usam a mesma janela, os próximos 30 dias, e as dicas dizem isso
  const next30 = upcomingEvents.filter((event) => new Date(event.startsAt).getTime() <= now + 30 * DAY);
  const thirtyDays = next30.length;
  const exams30 = next30.filter((event) => event.category === "exam");
  const pointsAtStake = next30.reduce((sum, event) => sum + (event.points ?? 0), 0);
  // agendados: o aviso ainda não chegou (os que chegaram estão no card de avisos)
  const avisoIds = new Set((avisos ?? []).map((aviso) => aviso.id));
  const scheduled = reminders
    .filter(
      (reminder) =>
        reminder.enabled &&
        !avisoIds.has(reminder.id) &&
        new Date(reminder.sendAt).getTime() > now &&
        reminder.academicEvent?.status !== "cancelled" &&
        reminder.academicEvent?.status !== "completed"
    )
    .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime());
  const myClass = context?.enrollments[0]?.academicClass ?? null;

  // Pontos por disciplina nos 30 dias, para a barra do KPI.
  const pointsBySubject = Object.entries(
    next30.reduce<Record<string, number>>((acc, event) => {
      if (event.points) {
        const name = event.subject?.name ?? "Outros";
        acc[name] = (acc[name] ?? 0) + event.points;
      }
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  // Disciplinas da turma e seus professores, tiradas dos próprios eventos.
  const subjects = [
    ...new Map(
      events
        .filter((event) => event.subject)
        .map((event) => [event.subject!.name, event.teacher?.fullName ?? null] as const)
    ),
  ].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  // Lembrete do destaque: o que veio no evento ou o da lista de lembretes.
  const heroReminder = nextEvent
    ? (nextEvent.reminder ?? reminders.find((reminder) => reminder.enabled && reminder.academicEventId === nextEvent.id) ?? null)
    : null;
  const quick = nextEvent && !heroReminder ? quickOffset(nextEvent, defaultReminderMinutes, now) : null;
  // sem lembrete agendado: um clique para lembrar da próxima prova que ainda não tem
  const examToRemind = onQuickReminder
    ? upcomingEvents.find(
        (event) =>
          event.category === "exam" &&
          !event.reminder &&
          !reminders.some((reminder) => reminder.enabled && reminder.academicEventId === event.id) &&
          quickOffset(event, defaultReminderMinutes, now) !== null
      )
    : undefined;

  /** Cria o lembrete do destaque; o botão gira até a resposta e não repete o clique. */
  function remindHero(event: AcademicEvent) {
    if (!onQuickReminder || quickId !== null || savingReminder) {
      return;
    }
    setQuickId(event.id);
    const result = onQuickReminder(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const done = () => setQuickId((current) => (current === event.id ? null : current));
      (result as Promise<unknown>).then(done, done);
    }
  }

  const heroSecondary = !nextEvent
    ? undefined
    : heroReminder
      ? { label: `Lembrete: ${reminderOffsetLabel(heroReminder.offsetMinutes)}`, icon: BellRing, onClick: () => onSelect(nextEvent.id) }
      : onQuickReminder
        ? quick
          ? {
              label: `Lembrar ${reminderOffsetLabel(quick)}`,
              icon: Bell,
              busy: quickId === nextEvent.id,
              onClick: () => remindHero(nextEvent),
            }
          : undefined
        : { label: "Ativar lembrete", icon: Bell, onClick: () => onSelect(nextEvent.id) };

  return (
    <div className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}

      {/* Destaque + turma (no celular e no tablet a turma vai para o fim do Painel) */}
      <div className={cx("grid items-stretch gap-5 max-xl:contents", context && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="rise" style={delay(0)}>
          <NextEventHero
            event={nextEvent}
            hideClass
            secondary={heroSecondary}
            onOpen={onSelect}
            onEmptyAction={{ label: "Ver cronograma", onClick: () => onOpenCalendar() }}
          />
        </div>

        {context ? (
          <section className="card pad rise flex flex-col max-xl:order-last" style={delay(1)} aria-label="Sua turma">
            <h2 className="disp text-[24px] font-bold leading-tight">{myClass?.name ?? "Sem turma"}</h2>
            <p className="sub">
              {myClass ? (myClass.course?.name ?? "Curso") : "Fale com a administração para vincular sua matrícula."}
            </p>
            {myClass ? (
              <div className="chips mt-3.5 gap-1.5">
                <span className="pill st-ag">{myClass.period}</span>
                <span className="pill st-ag capitalize">{myClass.shift}</span>
                <span className="pill st-ag">
                  {myClass.year}/{myClass.semester}
                </span>
              </div>
            ) : null}
            {subjects.length ? (
              <>
                <hr className="divider mt-[18px] mb-3.5" />
                <ul className="flex flex-col gap-2.5 text-sm">
                  {subjects.slice(0, 5).map(([subject, teacher]) => (
                    <li key={subject} className="flex justify-between gap-2.5">
                      <span className="truncate font-semibold">{subject}</span>
                      {teacher ? <span className="muted shrink-0">{teacher}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* Indicadores (os clicáveis levam ao lugar certo) */}
      <div className="kpis">
        <InsightTile
          icon={Target}
          label="Próximos 30 dias"
          order={2}
          value={String(thirtyDays)}
          hint={thirtyDays === 1 ? "evento no período" : "eventos no período"}
          actionLabel="Ver no cronograma"
          onClick={() => onOpenCalendar()}
        >
          <div className="-mt-10 flex justify-end">
            <WeekSpark events={next30} />
          </div>
        </InsightTile>
        <InsightTile
          icon={BookOpen}
          label="Provas à frente"
          order={3}
          value={String(exams30.length)}
          tone="c-prova"
          actionLabel="Ver as provas no cronograma"
          onClick={() => onOpenCalendar({ categories: ["exam"] })}
          hint={exams30.length ? "nos próximos 30 dias" : "nenhuma prova nos próximos 30 dias"}
          extra={
            exams30.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {exams30.slice(0, 4).map((event) => (
                  <button
                    key={event.id}
                    className="pill c-prova kpi-chip"
                    aria-label={`${event.title}, ${dateChip(event.startsAt)}`}
                    onClick={() => onSelect(event.id)}
                    type="button"
                  >
                    {dateChip(event.startsAt)}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
        <InsightTile
          icon={Bell}
          label="Lembretes agendados"
          order={4}
          value={String(scheduled.length)}
          tone="c-ativ"
          actionLabel="Abrir Lembretes"
          onClick={onOpenReminders}
          hint={scheduled.length ? `próximo aviso ${formatShortDateTime(scheduled[0].sendAt)}` : "nenhum lembrete agendado"}
        />
        <InsightTile
          icon={Trophy}
          label="Pontos em jogo"
          order={5}
          value={pointsAtStake ? String(pointsAtStake) : "0"}
          unit={pointsAtStake ? "pts" : undefined}
          tone="c-extra"
          hint={
            pointsBySubject.length
              ? `nos próximos 30 dias: ${pointsBySubject.map(([name, points]) => `${name} ${points}`).join(", ")}`
              : "nenhum ponto nos próximos 30 dias"
          }
        >
          {pointsBySubject.length ? (
            <div className="stack mt-3 h-2" aria-hidden>
              {pointsBySubject.map(([name, points], index) => (
                <span
                  key={name}
                  style={{ flex: points, background: ["var(--brand)", "var(--brand-400)", "var(--brand-200)"][index % 3] }}
                />
              ))}
            </div>
          ) : null}
        </InsightTile>
      </div>

      {/* Linha do tempo à esquerda (duas linhas) e apoio à direita: os cards crescem com o conteúdo */}
      <div className="board">
        <section className="card pad tall rise" style={delay(6)} aria-label="Próximos compromissos">
          <div className="head">
            <SectionTitle title="Próximos compromissos" />
            <button className="btn btn-s btn-sm" onClick={() => onOpenCalendar()} type="button">
              <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
              Ver cronograma
            </button>
          </div>
          <EventList
            className="mt-3.5"
            events={upcomingEvents}
            grouped
            hideClass
            limit={6}
            emptyIcon={CalendarDays}
            emptyText="Sem eventos futuros."
            emptyHint="Quando houver novos prazos, eles aparecem aqui."
            showAll={{
              label: "Ver todos no cronograma",
              // o Cronograma conta também os cancelados, os concluídos e os de hoje
              count: calendarUpcomingCount(events, now),
              onClick: () => onOpenCalendar(),
            }}
            onSelect={onSelect}
          />
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Próximos lembretes">
          {/* sem lembretes, o vazio logo abaixo já diz isso */}
          <SectionTitle
            title="Próximos lembretes"
            subtitle={
              scheduled.length
                ? `${scheduled.length} ${scheduled.length === 1 ? "lembrete agendado" : "lembretes agendados"}`
                : undefined
            }
          />
          <div className="mt-3.5 flex flex-col gap-2">
            {scheduled.slice(0, 3).map((reminder) => (
              <button
                key={reminder.id}
                className="mini"
                onClick={() => onSelect(reminder.academicEventId)}
                type="button"
              >
                <span className="mini-ico">
                  <Bell className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="mini-t block truncate">
                    {reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}
                  </span>
                  {/* mesmo formato da linha em Lembretes */}
                  <span className="mini-s block">
                    Aviso: {formatShortDateTime(reminder.sendAt)} ({reminderOffsetLabel(reminder.offsetMinutes)})
                  </span>
                </span>
              </button>
            ))}
            {!scheduled.length ? (
              <EmptyState
                compact
                icon={Bell}
                text="Nenhum lembrete agendado"
                hint={examToRemind ? `Próxima prova: ${examToRemind.title}.` : "Abra um evento e ative um lembrete."}
                action={
                  examToRemind && onQuickReminder
                    ? { label: "Lembrar da prova", onClick: () => void onQuickReminder(examToRemind) }
                    : undefined
                }
              />
            ) : null}
          </div>
          {/* a mesma frase já está no card de avisos quando há algum */}
          {!avisos?.length ? (
            <p className="kpi-hint">O aviso aparece aqui no sistema. O envio por e-mail é o próximo passo.</p>
          ) : null}
          <div className="card-foot">
            <button className="link" onClick={onOpenReminders} type="button">
              {scheduled.length > 3 ? `Ver todos os lembretes (${scheduled.length})` : "Gerenciar lembretes"}
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
            </button>
          </div>
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="Por categoria">
          <SectionTitle
            title="Por categoria"
            subtitle={`${thirtyDays} ${thirtyDays === 1 ? "evento" : "eventos"} nos próximos 30 dias`}
          />
          <div className="mt-4">
            <CategoryBreakdown
              counts={allCategories.map((category) => ({
                category,
                count: next30.filter((event) => event.category === category).length,
              }))}
              emptyText="Sem eventos nos próximos 30 dias."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
