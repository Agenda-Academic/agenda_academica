"use client";

import { ArrowRight, Bell, BookOpen, CalendarDays, Mail, Smartphone, Target, Trophy } from "lucide-react";
import type { CSSProperties } from "react";
import { formatDate } from "@/lib/format";
import { allCategories, reminderOffsetLabel } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Dashboard, Reminder } from "@/lib/types";
import { CategoryBreakdown, EventList, InsightTile, NextEventHero, WeekSpark, dateChip, delay } from "./dashboard-bits";
import { SectionTitle } from "./ui";

export function StudentDashboard({
  context,
  dashboard,
  events,
  reminders,
  upcomingEvents,
  onOpenCalendar,
  onOpenReminders,
  onSelect,
}: {
  context: AcademicContext | null;
  dashboard: Dashboard | null;
  events: AcademicEvent[];
  reminders: Reminder[];
  upcomingEvents: AcademicEvent[];
  onOpenCalendar: () => void;
  onOpenReminders: () => void;
  onSelect: (id: number) => void;
}) {
  const nextEvent = upcomingEvents[0] ?? null;
  const categories = dashboard?.metrics.categories ?? {};
  const pendingReminders = reminders.filter((reminder) => reminder.enabled && !reminder.sentAt);
  const byEmail = pendingReminders.filter((reminder) => reminder.channel === "email").length;
  const upcomingExams = upcomingEvents.filter((event) => event.category === "exam");
  const pointsAtStake = upcomingEvents.reduce((sum, event) => sum + (event.points ?? 0), 0);
  const myClass = context?.enrollments[0]?.academicClass ?? null;

  // Pontos por disciplina, para a barra do KPI.
  const pointsBySubject = Object.entries(
    upcomingEvents.reduce<Record<string, number>>((acc, event) => {
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

  const thirtyDays = dashboard?.metrics.upcomingCount ?? upcomingEvents.length;

  return (
    <div className="grid gap-5">
      {/* Destaque + turma */}
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rise" style={delay(0)}>
        <NextEventHero
          event={nextEvent}
          onOpen={onSelect}
          secondary={
            nextEvent
              ? nextEvent.reminder
                ? { label: "Lembrete ativo", icon: Bell, onClick: onOpenReminders }
                : { label: "Criar lembrete", icon: Bell, onClick: () => onSelect(nextEvent.id) }
              : undefined
          }
          onEmptyAction={{ label: "Ver cronograma", onClick: onOpenCalendar }}
        />
        </div>

        <section className="card pad rise flex flex-col" style={delay(1)} aria-label="Sua turma">
          <p className="eyebrow">Sua turma</p>
          <h2 className="disp mt-2 text-[34px] font-bold leading-none">{myClass?.name ?? "Sem turma"}</h2>
          <p className="sub">
            {myClass ? (myClass.course?.name ?? "Curso") : "Fale com a secretaria para vincular sua matrícula."}
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
              <ul className="flex flex-col gap-2.5 text-[13.5px]">
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
      </div>

      {/* Indicadores */}
      <div className="kpis">
        <InsightTile
          icon={Target}
          label="Próximos 30 dias"
          order={2}
          value={String(thirtyDays)}
          hint={thirtyDays === 1 ? "compromisso no período" : "compromissos no período"}
        >
          <div className="-mt-10 flex justify-end">
            <WeekSpark events={upcomingEvents} />
          </div>
        </InsightTile>
        <InsightTile icon={BookOpen} label="Provas à frente"
          order={3} value={String(upcomingExams.length)} tone="c-prova">
          {upcomingExams.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {upcomingExams.slice(0, 4).map((event) => (
                <span key={event.id} className="pill c-prova h-[22px] text-[11.5px]">
                  {dateChip(event.startsAt)}
                </span>
              ))}
            </div>
          ) : (
            <p className="kpi-hint">nenhuma prova marcada</p>
          )}
        </InsightTile>
        <InsightTile
          icon={Bell}
          label="Lembretes ativos"
          order={4}
          value={String(pendingReminders.length)}
          tone="c-ativ"
          hint={
            pendingReminders.length ? (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-[15px] w-[15px]" aria-hidden />
                  {byEmail} por e-mail
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="h-[15px] w-[15px]" aria-hidden />
                  {pendingReminders.length - byEmail} push
                </span>
              </span>
            ) : (
              "nenhum aguardando envio"
            )
          }
        />
        <InsightTile
          icon={Trophy}
          label="Pontos em jogo"
          order={5}
          value={pointsAtStake ? String(pointsAtStake) : "—"}
          unit={pointsAtStake ? "pts" : undefined}
          tone="c-extra"
          hint={
            pointsBySubject.length
              ? pointsBySubject.map(([name, points]) => `${name} ${points}`).join(" · ")
              : "pontuação informativa"
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

      {/* Linha do tempo + apoio: as duas colunas terminam na mesma linha */}
      {/* Linha do tempo à esquerda (duas linhas) e apoio à direita: tudo alinhado, com rolagem interna */}
      <div className="board" style={{ "--row": "310px" } as CSSProperties}>
        <section className="card pad tall rise" style={delay(6)} aria-label="Próximos compromissos">
          <div className="head">
            <SectionTitle
              eyebrow="Linha do tempo"
              title="Próximos compromissos"
              subtitle={`Provas, entregas e datas oficiais${myClass ? ` da ${myClass.name}` : ""} em ordem cronológica`}
            />
            <button className="btn btn-s btn-sm" onClick={onOpenCalendar} type="button">
              <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
              Ver cronograma
            </button>
          </div>
          <div className="scroll mt-3.5">
            <EventList
              events={upcomingEvents}
              grouped
              hideClass
              emptyIcon={CalendarDays}
              emptyText="Sem eventos futuros."
              emptyHint="Quando houver novos prazos, eles aparecem aqui."
              onSelect={onSelect}
            />
          </div>
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Próximos lembretes">
          <SectionTitle
            eyebrow="Alertas"
            title="Próximos lembretes"
            subtitle={`${pendingReminders.length} aguardando envio`}
          />
          <div className="scroll mt-3.5 flex flex-col gap-2">
            {pendingReminders.map((reminder) => (
              <button key={reminder.id} className="mini" onClick={onOpenReminders} type="button">
                <span className="mini-ico">
                  <Bell className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="mini-t block truncate">
                    {reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}
                  </span>
                  <span className="mini-s block">
                    Envio {formatDate(reminder.sendAt)} · {reminderOffsetLabel(reminder.offsetMinutes)} ·{" "}
                    {reminder.channel === "push" ? "Push" : "E-mail"}
                  </span>
                </span>
              </button>
            ))}
            {!pendingReminders.length ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center">
                <Bell className="h-5 w-5 text-brand" aria-hidden />
                <p className="mt-1 text-sm font-bold">Nenhum lembrete pendente</p>
                <p className="text-[12.5px] text-muted">Abra um evento e ative um lembrete.</p>
              </div>
            ) : null}
          </div>
          <button className="link mt-3" onClick={onOpenReminders} type="button">
            Gerenciar lembretes
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="O que vem pela frente">
          <SectionTitle
            eyebrow="Categorias"
            title="O que vem pela frente"
            subtitle={`${thirtyDays} ${thirtyDays === 1 ? "compromisso" : "compromissos"} nos próximos 30 dias`}
          />
          <div className="scroll mt-4">
            <CategoryBreakdown
              counts={allCategories.map((category) => ({
                category,
                count: categories[category] ?? events.filter((event) => event.category === category).length,
              }))}
              emptyText="Sem eventos futuros para distribuir."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
