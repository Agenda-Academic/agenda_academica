"use client";

import { ArrowRight, BookOpen, CalendarDays, CalendarPlus, CloudDownload, History, RefreshCw, ShieldCheck, Target, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { formatDate } from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, CalendarImport } from "@/lib/types";
import { CategoryBreakdown, EventList, InsightTile, delay } from "./dashboard-bits";
import { EmptyState, SectionTitle } from "./ui";

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
    <div className="grid gap-5">
      {/* Destaque institucional */}
      <section className="hero rise" style={delay(0)} aria-label="Calendário oficial">
        <div className="datebig">
          <CloudDownload className="h-10 w-10" aria-hidden />
          <span className="mo mt-2">Oficial</span>
        </div>
        <div className="hero-body">
          <div className="hero-kicker">
            <span className="eyebrow">Calendário da reitoria</span>
            {lastImport ? <span className="pill prio">Sincronizado</span> : <span className="pill st-alt">Pendente</span>}
          </div>
          <h2 className="hero-title">Visão institucional do calendário</h2>
          <p className="hero-meta">
            <span>
              {lastImport
                ? `Última sincronização em ${formatDate(lastImport.importedAt)} · ${lastImport.sourceName}`
                : "O calendário oficial ainda não foi importado neste período."}
            </span>
          </p>
          <div className="hero-actions">
            <button className="btn btn-p" onClick={onOpenSync} type="button">
              <CloudDownload className="h-4 w-4" aria-hidden />
              Sincronizar calendário
            </button>
            <button className="btn btn-ghost" onClick={onNewEvent} type="button">
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Novo evento oficial
            </button>
          </div>
        </div>
        <div className="countdown">
          <p className="eyebrow">Datas oficiais</p>
          <b>{officialCount}</b>
          <small>no período</small>
        </div>
      </section>

      <div className="kpis">
        <InsightTile icon={Target} label="Eventos futuros" order={2} value={String(upcomingEvents.length)} hint="em todas as turmas" />
        <InsightTile icon={ShieldCheck} label="Datas oficiais" order={3} value={String(officialCount)} tone="c-inst" hint="prevalecem sobre eventos locais" />
        <InsightTile icon={Users} label="Turmas ativas" order={4} value={String(classes.length)} tone="c-ativ" hint="no catálogo" />
        <InsightTile icon={BookOpen} label="Disciplinas ativas" order={5} value={String(subjects.length)} tone="c-trab" hint="no catálogo" />
      </div>

      {/* Pares de cards na mesma linha, com rolagem interna */}
      <div className="board" style={{ "--row": "390px" } as CSSProperties}>
        <section className="card pad rise" style={delay(6)} aria-label="Próximas datas oficiais">
          <SectionTitle eyebrow="Reitoria" title="Próximas datas oficiais" subtitle="O que toda a comunidade acadêmica vê com prioridade" />
          <div className="scroll mt-3.5">
            <EventList
              events={officialUpcoming}
              emptyIcon={CalendarDays}
              emptyText="Nenhuma data oficial futura."
              emptyHint="Importe o calendário da reitoria na Sincronização."
              onSelect={onSelect}
            />
          </div>
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Importações recentes">
          <SectionTitle
            eyebrow="Sincronização"
            title="Importações recentes"
            subtitle={`${imports.length} registro${imports.length === 1 ? "" : "s"} no histórico`}
          />
          <div className="scroll mt-3.5 flex flex-col gap-2">
            {imports.map((item) => (
              <button key={item.id} className="mini" onClick={onOpenSync} type="button">
                <span className="mini-ico">
                  <History className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="mini-t block truncate">{item.sourceName}</span>
                  <span className="mini-s block">
                    {formatDate(item.importedAt)} · {item.totalEvents} evento{item.totalEvents === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))}
            {!imports.length ? (
              <EmptyState icon={RefreshCw} text="Nenhuma importação realizada." hint="Use a Sincronização para trazer o calendário oficial." />
            ) : null}
          </div>
          <button className="link mt-3" onClick={onOpenSync} type="button">
            Abrir sincronização
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="Atividade por turma">
          <SectionTitle eyebrow="Turmas" title="Atividade por turma" subtitle="Eventos futuros publicados em cada turma" />
          <div className="scroll mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {classes.map((academicClass) => {
                const count = upcomingByClass(academicClass.id);
                return (
                  <div key={academicClass.id} className="rounded-2xl border border-line-2 bg-surface-2 p-4">
                    <p className="truncate text-[15.5px] font-bold">{academicClass.name}</p>
                    <p className="sub !mt-1">
                      {[academicClass.course?.code, academicClass.period, academicClass.shift].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-3">
                      <span className={count ? "dot bg-brand" : "dot bg-line-strong"} aria-hidden />
                      {count ? `${count} evento${count === 1 ? "" : "s"} à frente` : "Sem eventos futuros"}
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
        </section>

        <section className="card pad rise" style={delay(9)} aria-label="Distribuição geral">
          <SectionTitle eyebrow="Categorias" title="Distribuição geral" subtitle="Todos os eventos do período, por tipo" />
          <div className="scroll mt-4">
            <CategoryBreakdown
              counts={allCategories.map((category) => ({
                category,
                count: events.filter((event) => event.category === category).length,
              }))}
              emptyText="Nenhum evento cadastrado no período."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
