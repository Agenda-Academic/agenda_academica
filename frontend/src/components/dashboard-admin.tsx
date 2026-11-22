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
import { useId, useRef, useState } from "react";
import { cx, dayMonthText, formatOnDayAt, latestTermLabel, shiftLabel, startOfDay } from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, CalendarImport, Reminder } from "@/lib/types";
import { AdminPendingCard } from "./admin-pending-card";
import {
  AvisosCard,
  CategoryBreakdown,
  HeroButton,
  InsightTile,
  InstitutionDatesCard,
  PanelHero,
  calendarNote,
  calendarUpcomingCount,
  delay,
  heightKey,
  isOfficialDate,
  officialCategories,
  officialWhen,
  openAhead,
  upcomingOfficialDates,
  useColumnFill,
  useSavedReveal,
  type CalendarFilter,
} from "./dashboard-bits";
import { Pager, usePaged } from "./pager";
import { EmptyState, SectionTitle } from "./ui";

function datesLabel(count: number) {
  return count === 1 ? "1 data" : `${count} datas`;
}

/**
 * Turmas que "Atividade por turma" mostra por página (decisão 1: de 8 a 10): quatro linhas de duas. Com a lista
 * toda, a coluna larga passava muito da de apoio; com a página, useColumnFill encurta as datas da instituição ao
 * lado da lista e mostra mais importações na coluna de apoio, para as duas terminarem juntas.
 */
const CLASS_LIMIT = 8;

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
  onOpenClasses,
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
  /** Abre a tela Turmas e disciplinas (os indicadores de turmas e de disciplinas levam a ela). */
  onOpenClasses?: () => void;
  onSelect: (id: number) => void;
}) {
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  const { rootRef, savedId } = useSavedReveal<HTMLDivElement>(lastSavedId, savedTick, upcomingEvents);
  const classes = context?.catalog.classes ?? [];
  // mais de 8 turmas: uma página por vez (a lista não cresce no lugar)
  const classPages = usePaged(classes, CLASS_LIMIT, String(classes.length));
  const shownClasses = classPages.items;
  // trocar de página leva o foco (e a vista) para o card das turmas
  const classCardRef = useRef<HTMLElement>(null);
  const classTitleId = useId();
  const subjects = context?.catalog.subjects ?? [];
  const lastImport = imports[0] ?? null;
  // datas oficiais: a regra única de dashboard-bits (a mesma do card da Gestão e do filtro do Cronograma)
  const officialDates = upcomingOfficialDates(events ?? officialUpcoming, now);
  const officialCount = officialDates.length;
  // a próxima é a primeira que ainda vai começar; sem ela, a que está em andamento
  const today = startOfDay(new Date(now)).getTime();
  const nextOfficial =
    officialDates.find((event) => startOfDay(new Date(event.startsAt)).getTime() >= today) ?? officialDates[0] ?? null;
  // a próxima já está no destaque: o card "Datas da instituição" começa pela seguinte (decisão 13)
  const listedDates = nextOfficial ? officialDates.filter((event) => event.id !== nextOfficial.id) : officialDates;
  // eventos à frente (o "Próximos" do Cronograma sem os cancelados e os concluídos, o de hoje e o em
  // andamento inclusive): o indicador, a atividade por turma e a distribuição contam os mesmos
  const ahead = events ? openAhead(events, now) : upcomingEvents;
  const classEvents = ahead.filter((event) => event.academicClassId !== null).length;
  const campusEvents = ahead.length - classEvents;
  // "Eventos das turmas" (decisão 7, o mesmo número da Gestão): o valor é o que está à frente, sem as datas da
  // instituição, e a dica diz quantos há no total
  const classAhead = ahead.filter((event) => !isOfficialDate(event)).length;
  const classTotal = (events ?? upcomingEvents).filter((event) => !isOfficialDate(event)).length;
  const term = latestTermLabel(classes, now);
  const lastUpcoming = ahead[ahead.length - 1] ?? null;
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;
  // o Cronograma lista também os cancelados e os concluídos: os rodapés usam o número dele e os
  // indicadores dizem a diferença
  const officialListed = calendarUpcomingCount(events ?? officialDates, now, officialCategories);
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
    // desfeita: o que ela trouxe ("115 datas"), e a etiqueta "Desfeita" ao lado diz a situação (nada de "0 de 115")
    return current === item.totalEvents || isUndone(item)
      ? datesLabel(item.totalEvents)
      : `${current} de ${datesLabel(item.totalEvents)}`;
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
  // duas terminam juntas: "Datas da instituição" e "Importações recentes" mostram mais itens
  // enquanto a coluna delas for a mais baixa (ou menos, até o floor, quando a outra acabou). O card
  // Pendências fica na largura toda, acima das colunas: a altura dele muda muito (de "Tudo em dia" a
  // "Ver todos") e, numa coluna só, deixava a outra com um buraco grande no fim
  // Nenhum card estica (decisão 5): com poucas importações a coluna de apoio fica baixa, e as datas da instituição
  // podem descer até 2 para as colunas terminarem juntas
  const { gridRef, mainGapRef, sideGapRef, mainCount, sideCount, gridClass } = useColumnFill(
    { total: listedDates.length, min: 3, max: 8, floor: 2 },
    { total: imports.length, min: 3, max: 6 },
    [
      heightKey(listedDates.slice(0, 8)),
      imports
        .slice(0, 6)
        .map((item) => `${item.id}:${item.sourceName}:${item.status}:${currentDates(item)}`)
        .join(","),
      shownClasses.map((academicClass) => `${academicClass.id}:${upcomingByClass(academicClass.id)}`).join(","),
      classes.length > CLASS_LIMIT ? "paginas" : "",
      categoryCounts.map((item) => item.count).join(","),
      campusEvents,
    ].join("|")
  );

  return (
    <div ref={rootRef} className="pnl pnl-admin admin-dash grid gap-5">
      {/* Sem cabeçalho: o primeiro bloco é o destaque com a próxima data da instituição (a contagem, o nome e a
          folha da data), a situação do calendário oficial, a última importação e as duas ações de antes. O
          semestre que o cabeçalho dizia fica no subtítulo de "Atividade por turma" */}
      <div className="hero-slot rise" style={delay(0)}>
        <PanelHero
          kicker={nextOfficial ? "Próxima data da instituição" : "Calendário oficial"}
          category={nextOfficial?.category}
          pills={
            // situação do calendário: etiqueta com fundo, como as outras situações (Agendado, Concluído)
            officialCount ? (
              <span className="pill stat stat-conc">Calendário em dia</span>
            ) : (
              <span className="pill stat stat-alt">Calendário pendente</span>
            )
          }
          startsAt={nextOfficial?.startsAt}
          state={nextOfficial ? undefined : false}
          title={nextOfficial ? nextOfficial.title : lastImport ? "Calendário importado" : "Nenhum calendário importado"}
          description={nextOfficial ? undefined : <p>Nenhuma data da instituição à frente.</p>}
          sheetNote={nextOfficial ? undefined : "hoje"}
          facts={[
            ...(nextOfficial
              ? [
                  {
                    key: "quando",
                    icon: CalendarDays,
                    // com o ano fora do ano corrente: o 01/01 de 2027 e o de 2028 não se confundem. Os dias que
                    // faltam já estão na contagem grande
                    text: officialWhen(nextOfficial).replace(/^./, (first) => first.toUpperCase()),
                  },
                ]
              : []),
            { key: "importacao", icon: History, text: importLine },
            // o nome da fonte vem da importação: palavra ou link longo quebra em qualquer ponto
            ...(sourceLine ? [{ key: "fonte", icon: FileText, text: sourceLine }] : []),
          ]}
          actions={
            <>
              <HeroButton primary action={{ label: "Importar calendário", icon: CloudDownload, onClick: onOpenSync }} />
              {onNewEvent ? <HeroButton action={{ label: "Novo evento oficial", icon: Plus, onClick: onNewEvent }} /> : null}
            </>
          }
        />
      </div>

      <AvisosCard host avisos={avisos ?? []} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />

      <div className="kpis">
        {/* dois números que não se repetem: o que é das turmas e as datas da instituição (com o período) */}
        <InsightTile
          icon={Target}
          tone="k-brand"
          label="Eventos das turmas"
          order={2}
          value={String(classAhead)}
          hint={`${classTotal} no total`}
          actionLabel="Ver no cronograma"
          onClick={onOpenCalendar ? () => onOpenCalendar() : undefined}
        />
        <InsightTile
          icon={ShieldCheck}
          tone="k-azul"
          label="Datas da instituição"
          order={3}
          value={String(officialCount)}
          // a mesma dica da Gestão: curta, até quando vão as datas ("até janeiro de 2028"), sem repetir o número
          hint={
            officialDates.length
              ? `até ${new Date(officialDates[officialDates.length - 1].startsAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`
              : "nenhuma à frente"
          }
          note={officialNote}
          actionLabel="Ver as datas da instituição no cronograma"
          onClick={openOfficial}
        />
        {/* os quatro indicadores levam a algum lugar: os de turmas e disciplinas, à tela Turmas e disciplinas */}
        <InsightTile
          icon={Users}
          tone="k-ok"
          label="Turmas ativas"
          order={4}
          value={String(classes.length)}
          hint="no catálogo"
          actionLabel="Abrir Turmas e disciplinas"
          onClick={onOpenClasses}
        />
        <InsightTile
          icon={BookOpen}
          tone="k-lilas"
          label="Disciplinas ativas"
          order={5}
          value={String(subjects.length)}
          hint="no catálogo"
          actionLabel="Abrir Turmas e disciplinas"
          onClick={onOpenClasses}
        />
      </div>

      {/* Pendências na largura toda, com os itens em duas colunas no computador */}
      <div className="admin-pend-wide">
        <AdminPendingCard order={6} />
      </div>

      {/* Colunas do Figma (png 13): começam e terminam juntas, sem rolagem por dentro (useColumnFill) */}
      <div ref={gridRef} className={cx("duo", gridClass)}>
        <div className="duo-col duo-main">
          <InstitutionDatesCard
            emptyText={nextOfficial ? "Nenhuma outra data da instituição à frente" : undefined}
            events={listedDates}
            limit={mainCount}
            listed={officialListed}
            order={6}
            savedId={savedId}
            subtitle={
              nextOfficial
                ? "Depois da próxima, os feriados, recessos e eventos oficiais de todas as turmas"
                : "Feriados, recessos e eventos oficiais, para todas as turmas"
            }
            onOpenAll={openOfficial}
            onSelect={onSelect}
          />

          <section ref={classCardRef} className="card pad rise duo-fill" style={delay(8)} aria-labelledby={classTitleId}>
            <SectionTitle
              id={classTitleId}
              title="Atividade por turma"
              // o semestre que o cabeçalho da tela dizia ("Visão institucional do semestre 2026/2") fica aqui
              subtitle={
                campusEvents
                  ? `Semestre ${term}. ${campusEvents} ${campusEvents === 1 ? "evento oficial também vale" : "eventos oficiais também valem"} para todas as turmas`
                  : `Semestre ${term}`
              }
            />
            {classes.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {shownClasses.map((academicClass) => {
                  const count = upcomingByClass(academicClass.id);
                  // min-w-0: abaixo de 640 px a grade tem uma coluna só, do tamanho do conteúdo, e um
                  // nome longo de turma a alargaria para fora do card em vez de cortar com reticências
                  return (
                    <div key={academicClass.id} className="subj-card min-w-0 p-4">
                      <p className="truncate text-[15px] font-semibold text-ink">{academicClass.name}</p>
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
                <EmptyState compact icon={Users} text="Nenhuma turma cadastrada" />
              </div>
            )}
            <div ref={mainGapRef} className="fill-gap" aria-hidden />
            <Pager className="mt-4" paged={classPages} noun={["turma", "turmas"]} focusRef={classCardRef} />
          </section>
        </div>

        <div className="duo-col duo-side">
          <section className="card pad rise" style={delay(7)} aria-label="Importações recentes">
            <SectionTitle
              title="Importações recentes"
              subtitle={`${imports.length} registro${imports.length === 1 ? "" : "s"} no histórico`}
            />
            {/* lista só de leitura, em linhas com divisória (sem fundo nem contorno de cartão): nada aqui abre ao
                clicar. O rodapé leva ao histórico, na tela Importar calendário, onde cada importação abre as datas */}
            <div className="mt-3.5 flex flex-col gap-2">
              {imports.length ? (
                <ul className="admin-imp-list">
                  {imports.slice(0, sideCount).map((item) => {
                    const situation = item.status === "failed" ? "Falhou" : isUndone(item) ? "Desfeita" : null;
                    return (
                      <li key={item.id} className="admin-imp-row">
                        <History className="admin-imp-ico h-[18px] w-[18px]" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="mini-t block wrap-anywhere">{item.sourceName}</span>
                          <span className="mini-s block">
                            {/* a data é a da importação; a etiqueta diz a situação de agora. Uma que falhou não
                                importou nada: a linha diz só quando foi a tentativa */}
                            {item.status === "failed"
                              ? `Tentativa ${formatOnDayAt(item.importedAt)}`
                              : `Importada ${formatOnDayAt(item.importedAt)}, ${importDates(item)}`}
                          </span>
                          {situation ? (
                            <span className="mt-1.5 flex">
                              <span className={cx("pill stat", item.status === "failed" && "stat-canc")}>
                                {situation}
                              </span>
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!imports.length ? (
                <EmptyState
                  compact
                  icon={CloudDownload}
                  text="Nenhuma importação realizada"
                  hint="Use Importar calendário para trazer as datas oficiais."
                />
              ) : null}
            </div>
            <div className="card-foot">
              <button className="link" onClick={onOpenSync} type="button">
                {/* o "Importar calendário" já é a ação do destaque: aqui o caminho é o histórico */}
                {imports.length > sideCount ? `Ver todas as importações (${imports.length})` : "Ver histórico de importações"}
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </button>
            </div>
          </section>

          <section className="card pad rise duo-fill" style={delay(9)} aria-label="Distribuição geral">
            <SectionTitle
              title="Distribuição geral"
              subtitle={
                lastUpcoming
                  ? `${ahead.length} ${ahead.length === 1 ? "evento futuro" : "eventos futuros"}, de hoje até ${dayMonthText(lastUpcoming.startsAt)}`
                  : "Nenhum evento futuro"
              }
            />
            <div className="mt-4">
              <CategoryBreakdown counts={categoryCounts} emptyText="Nenhum evento futuro" />
            </div>
            {/* a sobra da coluna fica entre a lista e o link (como nos outros cards), e o link desce para o pé */}
            <div ref={sideGapRef} className="fill-gap" aria-hidden />
            {onOpenCalendar && ahead.length ? (
              <div className="card-foot">
                <button className="link" onClick={() => onOpenCalendar()} type="button">
                  Ver no cronograma
                  <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
