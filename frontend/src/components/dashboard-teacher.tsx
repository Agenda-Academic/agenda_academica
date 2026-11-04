"use client";

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  LayoutGrid,
  Megaphone,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  addDays,
  cx,
  dateParts,
  dayMonthRange,
  formatShortDate,
  formatTime,
  isWholeDay,
  shiftLabel,
  startOfDay,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Reminder } from "@/lib/types";
import {
  AvisosCard,
  EventList,
  InsightTile,
  NextEventHero,
  SavedPill,
  calendarNote,
  calendarUpcomingCount,
  delay,
  heightKey,
  isOfficialDate,
  isOfficialSource,
  officialCategories,
  officialWhen,
  showAllText,
  upcomingOfficialDates,
  useColumnFill,
  useSavedReveal,
  type CalendarFilter,
} from "./dashboard-bits";
import { eventLastDay } from "./event-bits";
import { EmptyState, SectionTitle } from "./ui";

/** Blocos de evento na semana; os que não cabem viram "+N eventos" no dia deles. */
const WEEK_LIMIT = 7;

/**
 * Até quantos itens "Meus próximos eventos" mostra para terminar junto com a coluna de apoio. Com a
 * semana muito cheia (7 blocos, continuações, sábado), a coluna de apoio vai de uns 1.200 a 1.450 px
 * e a lista precisa de 9 a 13 itens para a sobra ficar menor que um item. useColumnFill põe um item
 * por vez, antes da pintura: 16 deixa folga e fica longe do limite de atualizações seguidas do React.
 */
const MINE_MAX = 16;

type WeekDay = {
  key: number;
  date: Date;
  /** Eventos com bloco neste dia: os que começam nele (na segunda, também os que vêm de antes da semana). */
  events: AcademicEvent[];
  /** Eventos de vários dias que começaram antes deste dia e ainda valem nele (linha de continuação). */
  continuing: AcademicEvent[];
  /** Eventos do dia que ficaram sem bloco (WEEK_LIMIT). */
  hidden: number;
};

/**
 * Semana de aula de hoje, de segunda a sexta (no sábado e no domingo, a que vem), com todos os dias,
 * como no Figma: o dia sem nada mostra "Livre". Entram os eventos da docente, os de outros docentes
 * das turmas dela e os oficiais, sem os cancelados. Um evento que começa no sábado ou no domingo
 * estende a semana até ele. O de vários dias tem bloco no primeiro dia dele dentro da semana e, nos
 * dias seguintes que ele cobre, uma linha de continuação (esses dias não ficam "Livre"). As vagas de
 * bloco (WEEK_LIMIT) vão dia a dia, um evento de cada dia por rodada; o resto vira "+N eventos".
 */
function schoolWeek(events: AcademicEvent[], now: number) {
  const today = startOfDay(new Date(now));
  const weekday = today.getDay();
  const monday = addDays(today, weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday);
  const mondayTime = monday.getTime();
  const sundayTime = addDays(monday, 6).getTime();
  const dayOf = (event: AcademicEvent) => startOfDay(new Date(event.startsAt)).getTime();
  const firstDay = (event: AcademicEvent) => Math.max(dayOf(event), mondayTime);
  const inWeek = events
    .filter(
      (event) =>
        event.status !== "cancelled" && dayOf(event) <= sundayTime && eventLastDay(event).getTime() >= mondayTime
    )
    .sort(
      (a, b) => firstDay(a) - firstDay(b) || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
  // de segunda a sexta sempre; sábado e domingo só até o último dia em que algum evento começa
  const endTime = inWeek.reduce((end, event) => Math.max(end, firstDay(event)), addDays(monday, 4).getTime());
  const days: WeekDay[] = [];
  for (let date = monday; date.getTime() <= endTime; date = addDays(date, 1)) {
    days.push({ key: date.getTime(), date, events: [], continuing: [], hidden: 0 });
  }
  const queues = days.map((day) => inWeek.filter((event) => firstDay(event) === day.key));
  let room = WEEK_LIMIT;
  for (let round = 0; room > 0 && queues.some((queue) => queue.length > round); round += 1) {
    days.forEach((day, index) => {
      if (room > 0 && queues[index].length > round) {
        day.events.push(queues[index][round]);
        room -= 1;
      }
    });
  }
  days.forEach((day, index) => {
    day.hidden = queues[index].length - day.events.length;
    day.continuing = inWeek.filter((event) => firstDay(event) < day.key && eventLastDay(event).getTime() >= day.key);
  });
  // o que a semana lista (blocos e continuações), para o subtítulo
  const listed = [...new Set(days.flatMap((day) => [...day.continuing, ...day.events]))];
  const hidden = days.reduce((sum, day) => sum + day.hidden, 0);
  return { start: monday, end: new Date(endTime), days, listed, hidden };
}

/** O que muda a altura da semana (para as colunas refazerem a conta). */
function weekKey(days: WeekDay[]) {
  return days
    .map(
      (day) =>
        `${day.key}/${heightKey(day.events)}/${day.continuing.map((event) => `${event.id}:${event.title}`).join(";")}/${day.hidden}`
    )
    .join("~");
}

/** "19:00, você", "dia todo, oficial", "até qua, 18/11, oficial" ou "23:59, Profa. Marina Souza". */
function weekHint(event: AcademicEvent, mine: boolean) {
  const last = eventLastDay(event);
  const time =
    last.getTime() > startOfDay(new Date(event.startsAt)).getTime()
      ? `até ${formatShortDate(last)}`
      : isWholeDay(event.startsAt, event.endsAt)
        ? "dia todo"
        : formatTime(event.startsAt);
  const who = mine ? "você" : isOfficialSource(event) ? "oficial" : (event.teacher?.fullName ?? "outro docente");
  return `${time}, ${who}`;
}

/** O que entra na semana, para o subtítulo dizer só o que é verdade para os eventos listados. */
function weekSubtitle(events: AcademicEvent[], mine: (event: AcademicEvent) => boolean) {
  const official = events.filter(isOfficialSource);
  const others = events.some((event) => !mine(event) && !isOfficialSource(event));
  const officialText = official.length ? (official.every(isOfficialDate) ? "datas oficiais" : "eventos oficiais") : null;
  if (others && officialText) {
    return `Inclui eventos de outros docentes e ${officialText}`;
  }
  if (others) {
    return "Inclui eventos de outros docentes";
  }
  return officialText ? `Inclui ${officialText}` : undefined;
}

export function TeacherDashboard({
  avisos,
  context,
  events,
  lastSavedId,
  manageableEvents,
  officialUpcoming,
  referenceNow,
  savedTick,
  upcomingEvents,
  onDismissAviso,
  onEdit,
  onNewEvent,
  onNewEventFor,
  onOpenCalendar,
  onOpenManage,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /** Todos os eventos que a docente vê (os mesmos do Cronograma): a semana, as datas oficiais e as contagens. */
  events?: AcademicEvent[];
  /** Último evento salvo pelo painel lateral; com savedTick, o Painel mostra e marca esse evento. */
  lastSavedId?: number | null;
  manageableEvents: AcademicEvent[];
  /** Reserva para as datas oficiais quando events não vem. */
  officialUpcoming: AcademicEvent[];
  referenceNow: number;
  /** Muda a cada salvamento pelo painel lateral. */
  savedTick?: number;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  /** Abre o evento no painel de edição. */
  onEdit?: (event: AcademicEvent) => void;
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onOpenCalendar?: (filter?: CalendarFilter) => void;
  onOpenManage: () => void;
  onSelect: (id: number) => void;
}) {
  const { rootRef, savedId } = useSavedReveal<HTMLDivElement>(lastSavedId, savedTick, upcomingEvents);
  const assignments = context?.teachingAssignments ?? [];
  // os da docente que a Gestão mostra em "Próximos": abertos e que ainda não terminaram
  const myOpen = manageableEvents.filter(
    (event) =>
      event.status !== "cancelled" &&
      event.status !== "completed" &&
      new Date(event.endsAt ?? event.startsAt).getTime() >= referenceNow
  );
  const myUpcoming = myOpen.filter((event) => new Date(event.startsAt).getTime() >= referenceNow);
  // "você" na semana: o que a própria docente publicou (sem o contexto, os que ela gerencia)
  const myId = context?.user.id;
  const mineIds = new Set(manageableEvents.map((event) => event.id));
  const isMine = (event: AcademicEvent) => (myId !== undefined ? event.teacherId === myId : mineIds.has(event.id));
  const nextMine = myUpcoming[0] ?? null;
  const allEvents = events ?? upcomingEvents;
  // datas oficiais: a regra única de dashboard-bits (a mesma do card da Gestão e do filtro do Cronograma)
  const officialDates = upcomingOfficialDates(events ?? officialUpcoming, referenceNow);
  const week = schoolWeek(allEvents, referenceNow);
  const weekTitle = `Semana de ${dayMonthRange(week.start, week.end)}`;
  const classes = [
    ...new Map(
      assignments
        .filter((assignment) => assignment.academicClass)
        .map((assignment) => [assignment.academicClassId, assignment.academicClass!] as const)
    ).values(),
  ];
  const term = classes[0] ? `${classes[0].year}/${classes[0].semester}` : null;
  const classesHint =
    classes.length === 1
      ? [classes[0].name, shiftLabel(classes[0].shift)].filter(Boolean).join(", ")
      : classes.map((academicClass) => academicClass.name).join(", ") || "sem vínculo";
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;
  // o Cronograma aberto com as categorias oficiais lista também as canceladas e as concluídas:
  // o rodapé usa o número dele e o indicador diz a diferença
  const officialListed = calendarUpcomingCount(allEvents, referenceNow, officialCategories);
  const officialNote = calendarNote(allEvents, referenceNow, officialDates.length, {
    categories: officialCategories,
    feminine: true,
  });

  // as duas colunas terminam juntas: "Meus próximos eventos" e "Datas oficiais à frente" mostram
  // mais itens enquanto a coluna delas for a mais baixa (com a semana cheia, a lista passa de 8)
  const { gridRef, mainGapRef, sideGapRef, mainCount, sideCount } = useColumnFill(
    { total: myOpen.length, min: 3, max: MINE_MAX },
    { total: officialDates.length, min: 3, max: 6 },
    [
      assignments.length,
      heightKey(myOpen.slice(0, MINE_MAX)),
      heightKey(officialDates.slice(0, 6)),
      weekKey(week.days),
    ].join("|")
  );

  function upcomingCountFor(academicClassId: number, subjectId: number) {
    return myOpen.filter((event) => event.academicClassId === academicClassId && event.subjectId === subjectId).length;
  }

  return (
    <div ref={rootRef} className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}

      <div className="hero-slot rise" style={delay(0)}>
        <NextEventHero
          event={nextMine}
          kicker={nextMine?.category === "exam" ? "Sua próxima avaliação" : "Seu próximo evento"}
          hideTeacher
          showStatus
          countdownNote="visível para toda a turma"
          primaryAction={
            nextMine && onEdit ? { label: "Editar evento", icon: Pencil, onClick: () => onEdit(nextMine) } : undefined
          }
          saved={nextMine !== null && savedId === nextMine.id}
          secondary={
            nextMine && onEdit
              ? { label: "Ver no cronograma", onClick: () => onSelect(nextMine.id), opensEvent: nextMine.id }
              : { label: "Abrir gestão", icon: LayoutGrid, onClick: onOpenManage }
          }
          emptyTitle="Nenhum prazo publicado à frente"
          emptyText="Publique provas, trabalhos e atividades para as turmas que você ministra."
          onOpen={onSelect}
          onEmptyAction={{ label: "Novo evento", onClick: onNewEvent }}
        />
      </div>

      <div className="kpis">
        <InsightTile
          icon={Megaphone}
          label="Publicações futuras"
          order={2}
          value={String(myOpen.length)}
          hint="nas suas disciplinas"
          actionLabel="Abrir a Gestão"
          onClick={onOpenManage}
        />
        <InsightTile
          icon={Users}
          label="Turmas"
          order={3}
          value={String(classes.length)}
          tone="c-trab"
          hint={classesHint}
        />
        <InsightTile
          icon={BookOpen}
          label="Disciplinas"
          order={4}
          value={String(assignments.length)}
          tone="c-ativ"
          hint={term ? `no semestre ${term}` : "sem vínculo"}
        />
        <InsightTile
          icon={ShieldCheck}
          label="Datas oficiais à frente"
          order={5}
          value={String(officialDates.length)}
          tone="c-inst"
          hint="evite marcar provas nelas"
          note={openOfficial ? officialNote : null}
          actionLabel="Ver no cronograma"
          onClick={openOfficial}
        />
      </div>

      {/* Arranjo do Figma: turmas e próximos eventos na coluna larga; semana e datas oficiais ao lado */}
      <div ref={gridRef} className="duo">
        <div className="duo-col duo-main">
          <section className="card pad rise" style={delay(6)} aria-label="Minhas turmas e disciplinas">
            <SectionTitle title="Minhas turmas e disciplinas" />
            {assignments.length ? (
              <ul className="subj-grid">
                {assignments.map((assignment) => {
                  const count = upcomingCountFor(assignment.academicClassId, assignment.subjectId);
                  const subjectName = assignment.subject?.name ?? "Disciplina";
                  const className = assignment.academicClass?.name ?? "turma";
                  return (
                    <li
                      key={assignment.id}
                      className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[15.5px] font-bold">{subjectName}</p>
                        {/* nome de turma longo, sem espaço, quebra em qualquer ponto */}
                        <p className="sub !mt-1 wrap-anywhere">
                          {[
                            assignment.academicClass?.name,
                            shiftLabel(assignment.academicClass?.shift),
                            assignment.subject?.code,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink-3">
                        <span className={cx("dot", count ? "d-prova" : "bg-line-strong")} aria-hidden />
                        {count ? `${count} evento${count === 1 ? "" : "s"} à frente` : "Sem eventos futuros"}
                      </p>
                      <button
                        className="btn btn-s btn-sm w-fit"
                        aria-label={`Novo evento de ${subjectName} para ${className}`}
                        onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                        type="button"
                      >
                        <Plus className="h-[15px] w-[15px]" aria-hidden />
                        Evento
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyState
                  compact
                  icon={Users}
                  text="Sem turmas vinculadas."
                  hint="Peça à administração para vincular suas disciplinas e turmas."
                />
              </div>
            )}
          </section>

          <section className="card pad rise duo-fill" style={delay(7)} aria-label="Meus próximos eventos">
            <SectionTitle title="Meus próximos eventos" />
            <EventList
              className="mt-3"
              events={myOpen}
              limit={mainCount}
              fillRef={mainGapRef}
              savedId={savedId}
              emptyCompact
              emptyIcon={CalendarPlus}
              emptyText="Nenhum evento publicado ainda."
              emptyHint="Use os atalhos das disciplinas para publicar o primeiro."
              // o mesmo conjunto da aba "Próximos" da Gestão e do KPI "Publicações futuras"
              showAll={{ label: "Ver todos na Gestão", onClick: onOpenManage, always: true }}
              onSelect={onSelect}
            />
          </section>
        </div>

        <div className="duo-col duo-side">
          <section className="card pad rise" style={delay(8)} aria-label={weekTitle}>
            <SectionTitle title={weekTitle} subtitle={weekSubtitle(week.listed, isMine)} />
            {/* todos os dias da semana (Figma): "Livre" apagado no dia sem nada */}
            <ul className="wk">
              {week.days.map((day) => {
                const parts = dateParts(day.date.toISOString());
                const free = !day.events.length && !day.continuing.length && !day.hidden;
                return (
                  <li key={day.key} className="wk-day">
                    <span className="wk-label">
                      {parts.weekday} {parts.day}
                    </span>
                    <div className="wk-evs">
                      {day.continuing.map((event) => (
                        <p key={`segue-${event.id}`} className="wk-line">
                          <span className={cx("dot", categoryMeta[event.category].accent)} aria-hidden />
                          {event.title} ({eventLastDay(event).getTime() === day.key ? "último dia" : "continua"})
                        </p>
                      ))}
                      {day.events.map((event) => (
                        <button
                          key={event.id}
                          className={cx("wk-ev", categoryMeta[event.category].tint)}
                          data-event-id={event.id}
                          data-opens-event={event.id}
                          onClick={() => onSelect(event.id)}
                          type="button"
                        >
                          <span className="wk-t">{event.title}</span>
                          <span className="wk-h">{weekHint(event, isMine(event))}</span>
                          {savedId === event.id ? (
                            <span className="mt-1.5 flex">
                              <SavedPill />
                            </span>
                          ) : null}
                        </button>
                      ))}
                      {day.hidden ? (
                        <p className="wk-more">+{day.hidden === 1 ? "1 evento" : `${day.hidden} eventos`}</p>
                      ) : null}
                      {free ? <p className="wk-free">Livre</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {week.hidden && onOpenCalendar ? (
              // os que não couberam estão no Cronograma, que lista todos os próximos (não só a semana):
              // "+N eventos" no dia já diz quantos faltam, e o rodapé fica sem número
              <div className="card-foot">
                <button className="link" onClick={() => onOpenCalendar()} type="button">
                  Ver no cronograma
                  <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                </button>
              </div>
            ) : null}
          </section>

          <section className="card pad rise duo-fill" style={delay(9)} aria-label="Datas oficiais à frente">
            <SectionTitle title="Datas oficiais à frente" />
            {officialDates.length ? (
              <>
                <ul className="mt-3.5 flex flex-col gap-2">
                  {officialDates.slice(0, sideCount).map((event) => (
                    <li key={event.id}>
                      <button
                        className="mini"
                        data-event-id={event.id}
                        data-opens-event={event.id}
                        onClick={() => onSelect(event.id)}
                        type="button"
                      >
                        <span className="mini-ico text-[#1e40af]">
                          <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          {/* o título quebra linha; palavra ou link longo quebra em qualquer ponto */}
                          <span className="mini-t block wrap-anywhere">{event.title}</span>
                          <span className="mini-s block">
                            {officialWhen(event)}, {categoryMeta[event.category].short}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div ref={sideGapRef} className="fill-gap" aria-hidden />
                {officialDates.length > sideCount && openOfficial ? (
                  <div className="card-foot">
                    <button className="link" onClick={openOfficial} type="button">
                      {/* o N é o que o Cronograma lista (decisão 2) */}
                      {showAllText("Ver todas no cronograma", officialDates.length, officialListed)}
                      <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              // o vazio fica logo abaixo do título, como nos outros cards; a sobra vai para o espaçador
              <>
                <div className="mt-3.5">
                  <EmptyState compact icon={CalendarDays} text="Nenhuma data oficial à frente." />
                </div>
                <div ref={sideGapRef} className="fill-gap" aria-hidden />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
