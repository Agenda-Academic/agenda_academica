"use client";

import { ArrowRight, BookOpen, CalendarDays, CloudDownload, History, ShieldCheck, Target, Users } from "lucide-react";
import { useState } from "react";
import { formatOnDayAt, formatShortDateTime, formatWeekday } from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, CalendarImport, Reminder } from "@/lib/types";
import {
  AvisosCard,
  CategoryBreakdown,
  EventList,
  InsightTile,
  calendarUpcomingCount,
  delay,
  isOfficialDate,
  officialCategories,
  useSavedReveal,
  type CalendarFilter,
} from "./dashboard-bits";
import { EmptyState, SectionTitle } from "./ui";

/** "15/11". */
function shortDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function datesLabel(count: number) {
  return count === 1 ? "1 data" : `${count} datas`;
}

export function AdminDashboard({
  avisos,
  context,
  events,
  imports,
  lastSavedId,
  officialUpcoming,
  savedTick,
  upcomingEvents,
  onDismissAviso,
  onOpenCalendar,
  onOpenSync,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /**
   * Todos os eventos (os mesmos do Cronograma): contam as datas que cada importação ainda tem
   * no calendário, como em Importar calendário, e o "Ver todas (N)".
   */
  events?: AcademicEvent[];
  imports: CalendarImport[];
  /** Último evento salvo pelo painel lateral; com savedTick, o Painel mostra e marca esse evento. */
  lastSavedId?: number | null;
  officialUpcoming: AcademicEvent[];
  /** Muda a cada salvamento pelo painel lateral. */
  savedTick?: number;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  /** Mantido por compatibilidade: o novo evento oficial fica no botão do menu. */
  onNewEvent?: () => void;
  onOpenCalendar?: (filter?: CalendarFilter) => void;
  /** Abre a tela Importar calendário. */
  onOpenSync: () => void;
  onSelect: (id: number) => void;
}) {
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  const { rootRef, savedId } = useSavedReveal<HTMLDivElement>(lastSavedId, savedTick, upcomingEvents);
  const classes = context?.catalog.classes ?? [];
  const subjects = context?.catalog.subjects ?? [];
  const lastImport = imports[0] ?? null;
  // datas oficiais: mesma regra do filtro do Cronograma que o card abre
  const officialDates = officialUpcoming.filter(isOfficialDate);
  const nextOfficial = officialDates[0] ?? null;
  const officialCount = officialDates.length;
  const classEvents = upcomingEvents.filter((event) => event.academicClassId !== null).length;
  const campusEvents = upcomingEvents.length - classEvents;
  const lastUpcoming = upcomingEvents[upcomingEvents.length - 1] ?? null;
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;

  // datas que a importação ainda tem no calendário (sem a lista de eventos, vale o total importado)
  function currentDates(item: CalendarImport) {
    return events ? events.filter((event) => event.calendarImportId === item.id).length : item.totalEvents;
  }
  // desfeita: trouxe datas e nenhuma está mais no calendário (como em Importar calendário)
  const isUndone = (item: CalendarImport) => item.status !== "failed" && item.totalEvents > 0 && currentDates(item) === 0;

  // Situação do calendário: "Em dia" quando há datas oficiais à frente; a frase diz de onde elas vieram.
  const lastLine = lastImport
    ? isUndone(lastImport)
      ? `A última importação (${lastImport.sourceName}, ${formatOnDayAt(lastImport.importedAt)}) foi desfeita.`
      : `Última importação ${formatOnDayAt(lastImport.importedAt)}: ${lastImport.sourceName}.`
    : null;
  const status = officialCount
    ? lastLine
      ? `${lastLine} ${officialCount === 1 ? "1 data oficial à frente." : `${officialCount} datas oficiais à frente.`}`
      : `Nenhuma importação ainda. ${officialCount === 1 ? "A data foi lançada" : `As ${officialCount} datas foram lançadas`} manualmente.`
    : lastLine
      ? `${lastLine} Nenhuma data oficial à frente.`
      : "Nenhuma importação ainda e nenhuma data oficial à frente.";

  function upcomingByClass(academicClassId: number) {
    return upcomingEvents.filter((event) => event.academicClassId === academicClassId).length;
  }

  return (
    <div ref={rootRef} className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}

      {/* Destaque institucional */}
      <section className="hero with-date rise" style={delay(0)} aria-label="Calendário oficial">
        <div className="datebig">
          <CloudDownload className="h-10 w-10" aria-hidden />
          <span className="mo mt-2">Oficial</span>
        </div>
        <div className="hero-body">
          <div className="hero-kicker">
            <span className="eyebrow">Calendário oficial</span>
            {officialCount ? <span className="pill prio">Em dia</span> : <span className="pill st-alt">Falta importar</span>}
          </div>
          <h2 className="hero-title">Visão institucional do calendário</h2>
          <p className="hero-meta">
            <span>{status}</span>
          </p>
          <div className="hero-actions">
            <button className="btn btn-p" onClick={onOpenSync} type="button">
              <CloudDownload className="h-4 w-4" aria-hidden />
              Importar calendário
            </button>
          </div>
        </div>
        <div className="countdown next">
          <p className="eyebrow">Próxima data oficial</p>
          {nextOfficial ? (
            <>
              <b>{shortDate(nextOfficial.startsAt)}</b>
              <small title={nextOfficial.title}>{nextOfficial.title}</small>
            </>
          ) : (
            <small>Nenhuma data à frente</small>
          )}
        </div>
      </section>

      <div className="kpis">
        <InsightTile
          icon={Target}
          label="Eventos futuros"
          order={2}
          value={String(upcomingEvents.length)}
          hint={`${classEvents} das turmas e ${campusEvents} ${campusEvents === 1 ? "oficial" : "oficiais"}`}
          actionLabel="Ver no cronograma"
          onClick={onOpenCalendar ? () => onOpenCalendar() : undefined}
        />
        <InsightTile
          icon={ShieldCheck}
          label="Datas oficiais à frente"
          order={3}
          value={String(officialCount)}
          tone="c-inst"
          hint="aparecem para todas as turmas"
          actionLabel="Ver no cronograma"
          onClick={openOfficial}
        />
        <InsightTile icon={Users} label="Turmas ativas" order={4} value={String(classes.length)} tone="c-ativ" hint="no catálogo" />
        <InsightTile icon={BookOpen} label="Disciplinas ativas" order={5} value={String(subjects.length)} tone="c-trab" hint="no catálogo" />
      </div>

      {/* Pares de cards na mesma linha: começam e terminam juntos e crescem com o conteúdo */}
      <div className="board">
        <section className="card pad rise" style={delay(6)} aria-label="Próximas datas oficiais">
          <SectionTitle title="Próximas datas oficiais" />
          <EventList
            className="mt-3.5"
            events={officialDates}
            limit={5}
            savedId={savedId}
            emptyCompact
            emptyIcon={CalendarDays}
            emptyText="Nenhuma data oficial futura."
            emptyHint="Use Importar calendário para trazer as datas oficiais."
            showAll={
              openOfficial
                ? {
                    label: "Ver todas no cronograma",
                    // o Cronograma conta também as canceladas e as que estão em andamento
                    count: calendarUpcomingCount(events ?? officialDates, now, officialCategories),
                    onClick: openOfficial,
                  }
                : undefined
            }
            onSelect={onSelect}
          />
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Importações recentes">
          <SectionTitle
            title="Importações recentes"
            subtitle={`${imports.length} registro${imports.length === 1 ? "" : "s"} no histórico`}
          />
          <div className="mt-3.5 flex flex-col gap-2">
            {imports.slice(0, 3).map((item) => {
              const current = currentDates(item);
              const situation = item.status === "failed" ? "Falhou" : isUndone(item) ? "Desfeita" : null;
              return (
                <div key={item.id} className="mini">
                  <span className="mini-ico">
                    <History className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="mini-t block truncate">{item.sourceName}</span>
                    <span className="mini-s block">
                      {formatShortDateTime(item.importedAt)},{" "}
                      {current === item.totalEvents ? datesLabel(item.totalEvents) : `${current} de ${datesLabel(item.totalEvents)}`}
                    </span>
                    {situation ? (
                      <span className="mt-1.5 flex">
                        <span className="pill stat">{situation}</span>
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!imports.length ? (
              <EmptyState
                compact
                icon={CloudDownload}
                text="Nenhuma importação realizada."
                hint="Use Importar calendário para trazer as datas oficiais."
              />
            ) : null}
          </div>
          <div className="card-foot">
            <button className="link" onClick={onOpenSync} type="button">
              {imports.length > 3 ? `Ver todas as importações (${imports.length})` : "Importar calendário"}
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
            </button>
          </div>
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="Atividade por turma">
          <SectionTitle
            title="Atividade por turma"
            subtitle={
              campusEvents
                ? `${campusEvents} ${campusEvents === 1 ? "evento oficial também vale" : "eventos oficiais também valem"} para todas as turmas`
                : undefined
            }
          />
          {classes.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {classes.map((academicClass) => {
                const count = upcomingByClass(academicClass.id);
                return (
                  <div key={academicClass.id} className="rounded-2xl border border-line-2 bg-surface-2 p-4">
                    <p className="truncate text-[15.5px] font-bold">{academicClass.name}</p>
                    <p className="sub !mt-1">
                      {[academicClass.course?.code, academicClass.period, academicClass.shift].filter(Boolean).join(", ")}
                    </p>
                    <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink-3">
                      <span className={count ? "dot bg-brand" : "dot bg-line-strong"} aria-hidden />
                      {count ? `${count} evento${count === 1 ? "" : "s"} da turma à frente` : "Sem eventos futuros"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState compact icon={Users} text="Nenhuma turma cadastrada." />
            </div>
          )}
        </section>

        <section className="card pad rise" style={delay(9)} aria-label="Distribuição geral">
          <SectionTitle
            title="Distribuição geral"
            subtitle={
              lastUpcoming
                ? `${upcomingEvents.length} ${upcomingEvents.length === 1 ? "evento futuro" : "eventos futuros"}, de hoje até ${formatWeekday(lastUpcoming.startsAt)}`
                : "Nenhum evento futuro"
            }
          />
          <div className="mt-4">
            <CategoryBreakdown
              counts={allCategories.map((category) => ({
                category,
                count: upcomingEvents.filter((event) => event.category === category).length,
              }))}
              emptyText="Nenhum evento futuro."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
