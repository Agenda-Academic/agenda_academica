"use client";

import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  CloudDownload,
  Filter,
  GraduationCap,
  History,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { formatDate, formatFullDate } from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, CalendarImport } from "@/lib/types";
import { CategoryBar, EventList, InsightTile } from "./dashboard-bits";
import { EmptyState, SectionTitle, primaryButton, secondaryButton } from "./ui";

export function AdminDashboard({
  context,
  events,
  imports,
  officialUpcoming,
  upcomingEvents,
  onNewEvent,
  onOpenSync,
  onSelect,
}: {
  context: AcademicContext | null;
  events: AcademicEvent[];
  imports: CalendarImport[];
  officialUpcoming: AcademicEvent[];
  upcomingEvents: AcademicEvent[];
  onNewEvent: () => void;
  onOpenSync: () => void;
  onSelect: (id: number) => void;
}) {
  const classes = context?.catalog.classes ?? [];
  const subjects = context?.catalog.subjects ?? [];
  const lastImport = imports[0] ?? null;
  const officialCount = events.filter(
    (event) => event.source === "imported" || event.source === "official" || event.officialPriority
  ).length;

  function upcomingByClass(academicClassId: number) {
    return upcomingEvents.filter((event) => event.academicClassId === academicClassId).length;
  }

  return (
    <div className="grid gap-4">
      <section className="surface overflow-hidden">
        <div className="border-b border-slate-200/80 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                <Sparkles className="h-4 w-4" aria-hidden />
                {formatFullDate(new Date())}
              </span>
              <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950">
                Visão institucional do calendário
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {lastImport
                  ? `Última sincronização oficial em ${formatDate(lastImport.importedAt)} · ${lastImport.sourceName}`
                  : "O calendário oficial da reitoria ainda não foi importado neste período."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className={primaryButton} type="button" onClick={onOpenSync}>
                <CloudDownload className="h-4 w-4" aria-hidden />
                Sincronizar calendário
              </button>
              <button className={secondaryButton} type="button" onClick={onNewEvent}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Evento oficial
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200/80 sm:grid-cols-2 md:grid-cols-4">
          <InsightTile icon={Target} label="Eventos futuros" value={String(upcomingEvents.length)} />
          <InsightTile icon={ShieldCheck} label="Datas oficiais" value={String(officialCount)} />
          <InsightTile icon={Users} label="Turmas ativas" value={String(classes.length)} />
          <InsightTile icon={BookOpen} label="Disciplinas ativas" value={String(subjects.length)} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-4">
          <div className="surface p-4">
            <SectionTitle
              eyebrow="Reitoria"
              icon={ShieldCheck}
              title="Próximas datas oficiais"
              subtitle="O que toda a comunidade acadêmica vê com prioridade"
            />
            <div className="mt-4">
              <EventList
                events={officialUpcoming}
                limit={6}
                emptyIcon={CalendarDays}
                emptyText="Nenhuma data oficial futura."
                emptyHint="Importe o calendário da reitoria na Sincronização."
                onSelect={onSelect}
              />
            </div>
          </div>

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Turmas"
              icon={GraduationCap}
              title="Atividade por turma"
              subtitle="Eventos futuros publicados em cada turma"
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {classes.map((academicClass) => {
                const count = upcomingByClass(academicClass.id);
                return (
                  <div
                    key={academicClass.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="truncate font-semibold text-slate-950">{academicClass.name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {academicClass.course?.code ?? ""} · {academicClass.period} ·{" "}
                      <span className="capitalize">{academicClass.shift}</span>
                    </p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {count
                        ? `${count} evento${count === 1 ? "" : "s"} à frente`
                        : "Sem eventos futuros"}
                    </p>
                  </div>
                );
              })}
              {!classes.length ? (
                <div className="sm:col-span-2">
                  <EmptyState icon={Users} text="Nenhuma turma cadastrada." />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4">
          <div className="surface p-4">
            <SectionTitle
              eyebrow="Sincronização"
              icon={History}
              title="Importações recentes"
              subtitle={`${imports.length} registro${imports.length === 1 ? "" : "s"} no histórico`}
            />
            <div className="mt-4 grid gap-2">
              {imports.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60"
                  onClick={onOpenSync}
                  type="button"
                >
                  <p className="truncate text-sm font-semibold text-slate-950">{item.sourceName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(item.importedAt)} · {item.totalEvents} evento
                    {item.totalEvents === 1 ? "" : "s"}
                  </p>
                </button>
              ))}
              {!imports.length ? (
                <EmptyState
                  icon={RefreshCw}
                  text="Nenhuma importação realizada."
                  hint="Use a Sincronização para trazer o calendário oficial."
                />
              ) : null}
            </div>
          </div>

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Categorias"
              icon={Filter}
              title="Distribuição geral"
              subtitle="Todos os eventos do período, por tipo"
            />
            <div className="mt-4 grid gap-2.5">
              {allCategories.map((category) => (
                <CategoryBar
                  key={category}
                  category={category}
                  count={events.filter((event) => event.category === category).length}
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
