"use client";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Filter,
  Inbox,
  ShieldCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cx, formatDate, formatFullDate, formatTime, relativeDue } from "@/lib/format";
import { allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Dashboard, Reminder } from "@/lib/types";
import { EventRow } from "./event-bits";
import { EmptyState, SectionTitle, primaryButton } from "./ui";

function InsightTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="h-5 w-5 text-slate-400" aria-hidden />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function CategoryBar({ category, count, total }: { category: (typeof allCategories)[number]; count: number; total: number }) {
  const width = Math.max((count / total) * 100, count ? 10 : 2);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{categoryMeta[category].label}</span>
        <span className="font-semibold text-slate-950">{count}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cx("h-full rounded-full transition-all", categoryMeta[category].accent)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function DashboardView({
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
  const officialCount = events.filter(
    (event) => event.source === "imported" || event.source === "official" || event.officialPriority
  ).length;
  const categories = dashboard?.metrics.categories ?? {};
  const pendingReminders = reminders.filter((reminder) => reminder.enabled && !reminder.sentAt);

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="surface overflow-hidden">
          <div className="border-b border-slate-200/80 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {formatFullDate(new Date())}
                </span>
                <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950">
                  {nextEvent ? nextEvent.title : "Sem prazos urgentes no momento"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {nextEvent
                    ? `${categoryMeta[nextEvent.category].short} · ${relativeDue(nextEvent.startsAt)} · ${formatDate(nextEvent.startsAt)}`
                    : "Quando a agenda receber novos eventos, o próximo compromisso aparece aqui."}
                </p>
              </div>
              <button className={cx(primaryButton, "w-fit")} type="button" onClick={onOpenCalendar}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                Abrir cronograma
              </button>
            </div>
          </div>

          <div className="grid gap-px bg-slate-200/80 sm:grid-cols-2 md:grid-cols-4">
            <InsightTile
              icon={Target}
              label="Próximos 30 dias"
              value={String(dashboard?.metrics.upcomingCount ?? upcomingEvents.length)}
            />
            <InsightTile
              icon={Bell}
              label="Lembretes ativos"
              value={String(dashboard?.metrics.remindersCount ?? pendingReminders.length)}
            />
            <InsightTile icon={ShieldCheck} label="Eventos oficiais" value={String(officialCount)} />
            <InsightTile
              icon={BookOpen}
              label="Turmas visíveis"
              value={String(context?.catalog.classes.length ?? 0)}
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
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white empty:hidden">
            {attentionEvents.map((event, index) => (
              <EventRow
                key={event.id}
                event={event}
                compact
                separated={index < attentionEvents.length - 1}
                onClick={() => onSelect(event.id)}
              />
            ))}
          </div>
          {!attentionEvents.length ? (
            <div className="mt-4">
              <EmptyState icon={Inbox} text="Sem alertas importantes." hint="Você está em dia." />
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface p-4">
          <SectionTitle
            eyebrow="Semana"
            icon={CalendarClock}
            title="Agenda dos próximos dias"
            subtitle="Prazos, provas e eventos oficiais em ordem cronológica"
          />
          {upcomingEvents.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {upcomingEvents.slice(0, 8).map((event, index) => (
                <EventRow
                  key={event.id}
                  compact
                  event={event}
                  separated={index < Math.min(upcomingEvents.length, 8) - 1}
                  onClick={() => onSelect(event.id)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState icon={CalendarDays} text="Sem eventos futuros." />
            </div>
          )}
        </div>

        <div className="grid content-start gap-4">
          <div className="surface p-4">
            <SectionTitle
              eyebrow="Categorias"
              icon={Filter}
              title="Distribuição"
              subtitle="Leitura rápida do tipo de demanda"
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
                <EmptyState icon={Bell} text="Nenhum lembrete pendente." />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
