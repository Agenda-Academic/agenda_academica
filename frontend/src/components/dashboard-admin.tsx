"use client";

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CloudDownload,
  FileText,
  History,
  Plus,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { useState } from "react";
import { formatOnDayAt, formatShortDateTime, formatWeekday, shiftLabel, startOfDay } from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type { AcademicClass, AcademicContext, AcademicEvent, CalendarImport, Reminder } from "@/lib/types";
import {
  AvisosCard,
  CategoryBreakdown,
  EventList,
  InsightTile,
  calendarNote,
  calendarUpcomingCount,
  delay,
  heightKey,
  officialCategories,
  openAhead,
  upcomingOfficialDates,
  useColumnFill,
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

/** Semestre das turmas do catálogo (o mais recente) ou, sem turma, o do dia: "2026/2". */
function currentTerm(classes: AcademicClass[], now: number) {
  const latest = classes.reduce<AcademicClass | null>(
    (best, item) =>
      !best || item.year > best.year || (item.year === best.year && item.semester > best.semester) ? item : best,
    null
  );
  if (latest) {
    return `${latest.year}/${latest.semester}`;
  }
  const today = new Date(now);
  return `${today.getFullYear()}/${today.getMonth() < 6 ? 1 : 2}`;
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
  onNewEvent,
  onOpenCalendar,
  onOpenSync,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /**
   * Todos os eventos (os mesmos do Cronograma): as datas oficiais, as datas que cada importação
   * ainda tem no calendário (como em Importar calendário) e o "Ver todas (N)".
   */
  events?: AcademicEvent[];
  imports: CalendarImport[];
  /** Último evento salvo pelo painel lateral; com savedTick, o Painel mostra e marca esse evento. */
  lastSavedId?: number | null;
  /** Reserva para as datas oficiais quando events não vem. */
  officialUpcoming: AcademicEvent[];
  /** Muda a cada salvamento pelo painel lateral. */
  savedTick?: number;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  /** "Novo evento oficial" do destaque: abre o painel lateral, como o "Evento oficial" do menu. */
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
  // datas oficiais: a regra única de dashboard-bits (a mesma do card da Gestão e do filtro do Cronograma)
  const officialDates = upcomingOfficialDates(events ?? officialUpcoming, now);
  const officialCount = officialDates.length;
  // a próxima é a primeira que ainda vai começar; sem ela, a que está em andamento
  const today = startOfDay(new Date(now)).getTime();
  const nextOfficial =
    officialDates.find((event) => startOfDay(new Date(event.startsAt)).getTime() >= today) ?? officialDates[0] ?? null;
  // eventos à frente (o "Próximos" do Cronograma sem os cancelados e os concluídos, o de hoje e o em
  // andamento inclusive): o indicador, a atividade por turma e a distribuição contam os mesmos
  const ahead = events ? openAhead(events, now) : upcomingEvents;
  const classEvents = ahead.filter((event) => event.academicClassId !== null).length;
  const campusEvents = ahead.length - classEvents;
  const lastUpcoming = ahead[ahead.length - 1] ?? null;
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;
  // o Cronograma lista também os cancelados e os concluídos: os rodapés usam o número dele e os
  // indicadores dizem a diferença
  const calendarEvents = events ?? upcomingEvents;
  const officialListed = calendarUpcomingCount(events ?? officialDates, now, officialCategories);
  const aheadNote = onOpenCalendar ? calendarNote(calendarEvents, now, ahead.length) : null;
  const officialNote = openOfficial
    ? calendarNote(events ?? officialDates, now, officialCount, { categories: officialCategories, feminine: true })
    : null;

  // datas que a importação ainda tem no calendário (sem a lista de eventos, vale o total importado)
  function currentDates(item: CalendarImport) {
    return events ? events.filter((event) => event.calendarImportId === item.id).length : item.totalEvents;
  }
  // desfeita: trouxe datas e nenhuma está mais no calendário (como em Importar calendário)
  const isUndone = (item: CalendarImport) => item.status !== "failed" && item.totalEvents > 0 && currentDates(item) === 0;
  function importDates(item: CalendarImport) {
    const current = currentDates(item);
    return current === item.totalEvents ? datesLabel(item.totalEvents) : `${current} de ${datesLabel(item.totalEvents)}`;
  }

  // dados do destaque (Figma): quando foi a última importação e o que ela trouxe
  const importLine = lastImport ? `Última importação ${formatOnDayAt(lastImport.importedAt)}` : "Nenhuma importação ainda";
  const sourceLine = lastImport
    ? `${lastImport.sourceName}, ${
        lastImport.status === "failed" ? "falhou" : isUndone(lastImport) ? "desfeita" : importDates(lastImport)
      }`
    : null;

  function upcomingByClass(academicClassId: number) {
    return ahead.filter((event) => event.academicClassId === academicClassId).length;
  }

  const categoryCounts = allCategories.map((category) => ({
    category,
    count: ahead.filter((event) => event.category === category).length,
  }));

  // colunas do Figma: datas oficiais e turmas na larga, importações e distribuição na de apoio. As
  // duas terminam juntas: "Próximas datas oficiais" e "Importações recentes" mostram mais itens
  // enquanto a coluna delas for a mais baixa, e o card de baixo de cada uma guarda a sobra
  const { gridRef, mainGapRef, sideGapRef, mainCount, sideCount } = useColumnFill(
    { total: officialDates.length, min: 3, max: 8 },
    { total: imports.length, min: 3, max: 6 },
    [
      heightKey(officialDates.slice(0, 8)),
      imports
        .slice(0, 6)
        .map((item) => `${item.id}:${item.sourceName}:${item.status}:${currentDates(item)}`)
        .join(","),
      classes.map((academicClass) => `${academicClass.id}:${upcomingByClass(academicClass.id)}`).join(","),
      categoryCounts.map((item) => item.count).join(","),
      campusEvents,
    ].join("|")
  );

  return (
    <div ref={rootRef} className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}

      {/* Destaque institucional (Figma) */}
      <div className="hero-slot rise" style={delay(0)}>
        <section className="hero with-date" aria-label="Calendário oficial">
          <div className="datebig" aria-hidden>
            <ShieldCheck className="h-12 w-12" strokeWidth={1.6} />
          </div>
          <div className="hero-body">
            <div className="hero-kicker">
              <span className="eyebrow">Calendário oficial</span>
              {officialCount ? (
                <span className="pill bg-brand-50 text-brand-ink">
                  <span className="dot bg-brand" aria-hidden />
                  Em dia
                </span>
              ) : (
                <span className="pill st-alt">
                  <span className="dot d-extra" aria-hidden />
                  Pendente
                </span>
              )}
            </div>
            <h2 className="hero-title">Visão institucional do semestre {currentTerm(classes, now)}</h2>
            {/* o nome da fonte vem da importação: palavra ou link longo quebra em qualquer ponto */}
            <div className="hero-meta wrap-anywhere">
              <span>
                <History className="h-[15px] w-[15px]" aria-hidden />
                {importLine}
              </span>
              {sourceLine ? (
                <span>
                  <FileText className="h-[15px] w-[15px]" aria-hidden />
                  {sourceLine}
                </span>
              ) : null}
            </div>
            <div className="hero-actions">
              <button className="btn btn-p" data-primary-action onClick={onOpenSync} type="button">
                <CloudDownload className="h-4 w-4" aria-hidden />
                Importar calendário
              </button>
              {onNewEvent ? (
                <button className="btn btn-s" onClick={onNewEvent} type="button">
                  <Plus className="h-4 w-4" aria-hidden />
                  Novo evento oficial
                </button>
              ) : null}
            </div>
          </div>
          <div className="countdown next">
            <p className="eyebrow">Próxima data oficial</p>
            {nextOfficial ? (
              <>
                <b>{shortDate(nextOfficial.startsAt)}</b>
                {/* no computador, uma linha com reticências; no celular, o nome quebra linha, e a
                    palavra ou o link longo quebra em qualquer ponto */}
                <small className="wrap-anywhere" title={nextOfficial.title}>
                  {nextOfficial.title}
                </small>
              </>
            ) : (
              <small>Nenhuma data à frente</small>
            )}
          </div>
        </section>
      </div>

      <div className="kpis">
        <InsightTile
          icon={Target}
          label="Eventos futuros"
          order={2}
          value={String(ahead.length)}
          hint={`${classEvents} das turmas e ${campusEvents} ${campusEvents === 1 ? "oficial" : "oficiais"}`}
          note={aheadNote}
          actionLabel="Ver no cronograma"
          onClick={onOpenCalendar ? () => onOpenCalendar() : undefined}
        />
        <InsightTile
          icon={ShieldCheck}
          label="Datas oficiais à frente"
          order={3}
          value={String(officialCount)}
          tone="c-inst"
          // vale para todas elas, com turma ou sem
          hint="com prioridade institucional"
          note={officialNote}
          actionLabel="Ver no cronograma"
          onClick={openOfficial}
        />
        <InsightTile icon={Users} label="Turmas ativas" order={4} value={String(classes.length)} tone="c-trab" hint="no catálogo" />
        <InsightTile icon={BookOpen} label="Disciplinas ativas" order={5} value={String(subjects.length)} tone="c-ativ" hint="no catálogo" />
      </div>

      {/* Colunas do Figma (png 13): começam e terminam juntas, sem rolagem por dentro (useColumnFill) */}
      <div ref={gridRef} className="duo">
        <div className="duo-col duo-main">
          <section className="card pad rise" style={delay(6)} aria-label="Próximas datas oficiais">
            <SectionTitle title="Próximas datas oficiais" />
            <EventList
              className="mt-3.5"
              events={officialDates}
              limit={mainCount}
              savedId={savedId}
              emptyCompact
              emptyIcon={CalendarDays}
              emptyText="Nenhuma data oficial à frente."
              emptyHint="Use Importar calendário para trazer as datas oficiais."
              showAll={
                openOfficial
                  ? {
                      label: "Ver todas no cronograma",
                      // o N é o que o Cronograma lista (com as canceladas e as concluídas)
                      count: officialListed,
                      onClick: openOfficial,
                    }
                  : undefined
              }
              onSelect={onSelect}
            />
          </section>

          <section className="card pad rise duo-fill" style={delay(8)} aria-label="Atividade por turma">
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
                  // min-w-0: abaixo de 640 px a grade tem uma coluna só, do tamanho do conteúdo, e um
                  // nome longo de turma a alargaria para fora do card em vez de cortar com reticências
                  return (
                    <div key={academicClass.id} className="min-w-0 rounded-2xl border border-line-2 bg-surface-2 p-4">
                      <p className="truncate text-[15.5px] font-bold">{academicClass.name}</p>
                      <p className="sub !mt-1">
                        {[academicClass.course?.code, academicClass.period, shiftLabel(academicClass.shift)]
                          .filter(Boolean)
                          .join(", ")}
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
            <div ref={mainGapRef} className="fill-gap" aria-hidden />
          </section>
        </div>

        <div className="duo-col duo-side">
          <section className="card pad rise" style={delay(7)} aria-label="Importações recentes">
            <SectionTitle
              title="Importações recentes"
              subtitle={`${imports.length} registro${imports.length === 1 ? "" : "s"} no histórico`}
            />
            <div className="mt-3.5 flex flex-col gap-2">
              {imports.slice(0, sideCount).map((item) => {
                const situation = item.status === "failed" ? "Falhou" : isUndone(item) ? "Desfeita" : null;
                return (
                  <div key={item.id} className="mini">
                    <span className="mini-ico">
                      <History className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="mini-t block wrap-anywhere">{item.sourceName}</span>
                      <span className="mini-s block">
                        {formatShortDateTime(item.importedAt)}, {importDates(item)}
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
                {imports.length > sideCount ? `Ver todas as importações (${imports.length})` : "Importar calendário"}
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </button>
            </div>
          </section>

          <section className="card pad rise duo-fill" style={delay(9)} aria-label="Distribuição geral">
            <SectionTitle
              title="Distribuição geral"
              subtitle={
                lastUpcoming
                  ? `${ahead.length} ${ahead.length === 1 ? "evento futuro" : "eventos futuros"}, de hoje até ${formatWeekday(lastUpcoming.startsAt)}`
                  : "Nenhum evento futuro"
              }
            />
            <div className="mt-4">
              <CategoryBreakdown counts={categoryCounts} emptyText="Nenhum evento futuro." />
            </div>
            <div ref={sideGapRef} className="fill-gap" aria-hidden />
          </section>
        </div>
      </div>
    </div>
  );
}
