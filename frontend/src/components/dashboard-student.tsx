"use client";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Filter,
  GraduationCap,
  Inbox,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { cx, formatDate, formatFullDate, formatTime, relativeDue } from "@/lib/format";
import { allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Dashboard, Reminder } from "@/lib/types";
import { CategoryBar, EventList, InsightTile } from "./dashboard-bits";
import { EmptyState, SectionTitle, primaryButton } from "./ui";

export function StudentDashboard({
  attentionEvents,
  context,
  dashboard,
  events,
  lastLoadedAt,
  reminders,
  upcomingEvents,
  onOpenCalendar,
  onOpenReminders,
  onSelect,
}: {
  attentionEvents: AcademicEvent[];
  context: AcademicContext | null;
  dashboard: Dashboard | null;
  events: AcademicEvent[];
  lastLoadedAt: Date | null;
  reminders: Reminder[];
  upcomingEvents: AcademicEvent[];
  onOpenCalendar: () => void;
  onOpenReminders: () => void;
  onSelect: (id: number) => void;
}) {
  const nextEvent = upcomingEvents[0] ?? null;
  const categories = dashboard?.metrics.categories ?? {};
  const pendingReminders = reminders.filter((reminder) => reminder.enabled && !reminder.sentAt);
  const upcomingExams = upcomingEvents.filter((event) => event.category === "exam");
  const pointsAtStake = upcomingEvents.reduce((sum, event) => sum + (event.points ?? 0), 0);
  const enrollment = context?.enrollments[0] ?? null;
  const myClass = enrollment?.academicClass ?? null;

  return (
    <div className="grid gap-4">
      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface overflow-hidden">
          <div className="border-b border-slate-200/80 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {formatFullDate(new Date())}
                </span>
                <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950">
                  {nextEvent ? nextEvent.title : "Você está em dia com os prazos"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {nextEvent
                    ? `${categoryMeta[nextEvent.category].short} · ${relativeDue(nextEvent.startsAt)} · ${formatDate(nextEvent.startsAt)}${nextEvent.location ? ` · ${nextEvent.location}` : ""}`
                    : "Quando seus professores publicarem novos prazos, eles aparecem aqui."}
                </p>
              </div>
              <button className={cx(primaryButton, "w-fit")} type="button" onClick={onOpenCalendar}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                Ver cronograma
              </button>
            </div>
          </div>

          <div className="grid gap-px bg-slate-200/80 sm:grid-cols-2 md:grid-cols-4">
            <InsightTile
              icon={Target}
              label="Próximos 30 dias"
              value={String(dashboard?.metrics.upcomingCount ?? upcomingEvents.length)}
            />
            <InsightTile icon={BookOpen} label="Provas à frente" value={String(upcomingExams.length)} />
            <InsightTile icon={Bell} label="Lembretes ativos" value={String(pendingReminders.length)} />
            <InsightTile
              icon={Trophy}
              label="Pontos em jogo"
              value={pointsAtStake ? `${pointsAtStake}` : "—"}
              hint="pontuação informativa"
            />
          </div>
        </div>

        <div className="surface p-4">
          <SectionTitle
            eyebrow="Agora"
            icon={AlertTriangle}
            title="Fila de atenção"
            subtitle={
              lastLoadedAt ? `Atualizado às ${formatTime(lastLoadedAt.toISOString())}` : "Aguardando dados"
            }
          />
          <div className="mt-4">
            <EventList
              events={attentionEvents}
              hideClass
              emptyIcon={Inbox}
              emptyText="Sem alertas importantes."
              emptyHint="Você está em dia."
              onSelect={onSelect}
            />
          </div>
        </div>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface p-4">
          <SectionTitle
            eyebrow="Semana"
            icon={CalendarClock}
            title="Meus próximos compromissos"
            subtitle="Prazos e datas oficiais da sua turma em ordem cronológica"
          />
          <div className="mt-4">
            <EventList
              events={upcomingEvents}
              hideClass
              limit={8}
              emptyIcon={CalendarDays}
              emptyText="Sem eventos futuros."
              onSelect={onSelect}
            />
          </div>
        </div>

        <div className="grid content-start gap-4">
          {myClass ? (
            <div className="surface p-4">
              <SectionTitle
                eyebrow="Matrícula"
                icon={GraduationCap}
                title={myClass.name}
                subtitle={myClass.course?.name ?? "Curso"}
              />
              <div className="mt-4 flex flex-wrap gap-1.5 text-xs font-semibold">
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
                  {myClass.period}
                </span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 capitalize text-slate-600">
                  {myClass.shift}
                </span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
                  {myClass.year}/{myClass.semester}
                </span>
              </div>
            </div>
          ) : (
            <div className="surface p-4">
              <SectionTitle
                eyebrow="Matrícula"
                icon={GraduationCap}
                title="Sem turma vinculada"
                subtitle="Fale com a secretaria para vincular sua matrícula"
              />
            </div>
          )}

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Alertas"
              icon={Bell}
              title="Próximos lembretes"
              subtitle={`${pendingReminders.length} aguardando envio`}
            />
            <div className="mt-4 grid gap-2">
              {pendingReminders.slice(0, 3).map((reminder) => (
                <button
                  key={reminder.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60"
                  onClick={onOpenReminders}
                  type="button"
                >
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Envio {formatDate(reminder.sendAt)}</p>
                </button>
              ))}
              {!pendingReminders.length ? (
                <EmptyState
                  icon={Bell}
                  text="Nenhum lembrete pendente."
                  hint="Abra um evento e ative um lembrete pessoal."
                />
              ) : null}
            </div>
          </div>

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Categorias"
              icon={Filter}
              title="Distribuição"
              subtitle="O que vem pela frente, por tipo"
            />
            <div className="mt-4 grid gap-2.5">
              {allCategories.map((category) => (
                <CategoryBar
                  key={category}
                  category={category}
                  count={
                    categories[category] ?? events.filter((event) => event.category === category).length
                  }
                  total={Math.max(events.length, 1)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
