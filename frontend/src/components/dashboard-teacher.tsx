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
  classTermLabel,
  countText,
  cx,
  dateParts,
  firstName,
  formatShortDate,
  formatTime,
  isWholeDay,
  relativeDue,
  shiftLabel,
  startOfDay,
  weekRangeLabel,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Reminder } from "@/lib/types";
import {
  AvisosCard,
  EventList,
  InsightTile,
  InstitutionDatesCard,
  NextEventHero,
  SavedPill,
  calendarUpcomingCount,
  delay,
  heightKey,
  isOfficialDate,
  isOfficialSource,
  officialCategories,
  upcomingOfficialDates,
  useColumnFill,
  useSavedReveal,
  useWideLayout,
  type CalendarFilter,
} from "./dashboard-bits";
import { eventLastDay } from "./event-bits";
import { EmptyState, PageHeader, SectionTitle } from "./ui";

/** Blocos de evento na semana; os que não cabem viram "+N eventos" no dia deles. */
const WEEK_LIMIT = 7;

/**
 * Lado a lado, "Meus próximos eventos" fica na coluna de apoio, embaixo da semana, e as datas da instituição na
 * coluna larga, embaixo das turmas: cada coluna tem uma lista, e useColumnFill põe ou tira itens de cada uma até as
 * duas terminarem juntas (decisão 5). Com a semana cheia, a coluna de apoio passa de 1.200 px: a lista da docente
 * vai até MINE_MAX e as datas, até DATES_MAX.
 */
const MINE_MAX = 12;
const DATES_MAX = 10;

/** Uma semana em ms (para comparar a semana do Painel com a de hoje). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Título da semana com a mesma regra do Cronograma (semanas de domingo a sábado, como a grade do calendário):
 * "Esta semana, 15 a 21 de nov" ou, no sábado, "Próxima semana, 22 a 28 de nov". O dia da semana de aula (a
 * segunda) diz qual é a semana. Com o intervalo por extenso, o título não parece o "semana 16 de 20" do semestre.
 */
function weekTitleOf(monday: Date, now: number) {
  const sunday = addDays(monday, -1);
  const today = startOfDay(new Date(now));
  const thisSunday = addDays(today, -today.getDay());
  const offset = Math.round((sunday.getTime() - thisSunday.getTime()) / WEEK_MS);
  const range = weekRangeLabel(sunday, addDays(sunday, 6));
  return offset === 0 ? `Esta semana, ${range}` : offset === 1 ? `Próxima semana, ${range}` : `Semana de ${range}`;
}

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

const shortMonthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "01 jan": a data no número grande do indicador. */
function shortDayMonth(value: string) {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")} ${shortMonthNames[date.getMonth()]}`;
}

/** O ano ao lado do número, só fora do ano corrente. */
function yearUnit(value: string) {
  const year = new Date(value).getFullYear();
  return year === new Date().getFullYear() ? undefined : String(year);
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
  const weekTitle = weekTitleOf(week.start, referenceNow);
  const todayKey = startOfDay(new Date(referenceNow)).getTime();
  // semana sem nada: uma linha só, "Semana livre" (em vez de cinco "Livre"); o próximo evento já está no destaque
  const weekEmpty = week.listed.length === 0 && week.hidden === 0;
  const nextOfficial = officialDates.find((event) => startOfDay(new Date(event.startsAt)).getTime() >= todayKey) ?? officialDates[0] ?? null;
  // a próxima já está no indicador "Próxima data da instituição": o card das datas começa pela seguinte (decisão 13)
  const listedDates = nextOfficial ? officialDates.filter((event) => event.id !== nextOfficial.id) : officialDates;
  const classes = [
    ...new Map(
      assignments
        .filter((assignment) => assignment.academicClass)
        .map((assignment) => [assignment.academicClassId, assignment.academicClass!] as const)
    ).values(),
  ];
  // turma anual (integrado) sai como "2026", nunca "2026/0"
  const term = classes[0] ? classTermLabel(classes[0]) : null;
  const classesHint =
    classes.length === 1
      ? [classes[0].name, shiftLabel(classes[0].shift)].filter(Boolean).join(", ")
      : classes.map((academicClass) => academicClass.name).join(", ") || "sem vínculo";
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;
  // indicadores Turmas e Disciplinas: levam ao card "Minhas turmas e disciplinas", com o foco no título dele
  // (todos os indicadores do Painel clicam, como no da administração)
  const openClassesCard = () => {
    const heading = document.getElementById("prof-turmas-titulo");
    if (!heading) {
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.closest("section")?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  // o Cronograma aberto com as categorias oficiais lista também as canceladas e as concluídas:
  // o rodapé usa o número dele e o indicador diz a diferença
  const officialListed = calendarUpcomingCount(allEvents, referenceNow, officialCategories);
  // com um evento só, ele já está no destaque: a lista não o repete e mostra o caminho para publicar mais
  const listEvents = myOpen.length === 1 && nextMine && myOpen[0].id === nextMine.id ? [] : myOpen;

  // as duas colunas terminam juntas (decisão 5): as datas da instituição (coluna larga) e "Meus próximos eventos"
  // (coluna de apoio, embaixo da semana) mostram mais ou menos itens até as colunas fecharem na mesma linha; a
  // pequena sobra que restar vai para o último card da coluna mais baixa (duo-even)
  // lado a lado (1280 px ou mais) ou numa coluna só: o JSX muda de ordem, não o CSS (o foco segue a tela)
  const wide = useWideLayout();
  const { gridRef, mainGapRef, sideGapRef, mainCount, sideCount, gridClass } = useColumnFill(
    { total: listedDates.length, min: 3, max: DATES_MAX, floor: 1 },
    { total: listEvents.length, min: 3, max: MINE_MAX, floor: 1 },
    [
      assignments.length,
      heightKey(listEvents.slice(0, MINE_MAX)),
      heightKey(listedDates.slice(0, DATES_MAX)),
      weekKey(week.days),
      weekEmpty,
      wide,
    ].join("|")
  );
  // cabeçalho da tela: "Olá, Maraísa" e as turmas com o semestre, na ordem do Painel do aluno ("TADS 5, semestre
  // 2026/2"); com mais de duas turmas, só o número delas (a linha não cresce sem fim)
  const greeting = `Olá, ${firstName(context?.user.fullName ?? "docente")}`;
  const classesText = classes.length
    ? classes.length > 2
      ? countText(classes.length, "turma", "turmas")
      : classes.map((item) => item.name).join(", ")
    : null;
  const headSubtitle = [classesText, term ? `${classesText ? "semestre" : "Semestre"} ${term}` : null]
    .filter(Boolean)
    .join(", ");

  function upcomingCountFor(academicClassId: number, subjectId: number) {
    return myOpen.filter((event) => event.academicClassId === academicClassId && event.subjectId === subjectId).length;
  }

  // os quatro cards de baixo; lado a lado ficam em duas colunas, numa coluna só seguem a ordem da docente
  const turmasCard = (
    <section className="card pad rise prof-turmas" style={delay(6)} aria-labelledby="prof-turmas-titulo">
      <SectionTitle id="prof-turmas-titulo" title="Minhas turmas e disciplinas" />
      {assignments.length ? (
        <ul className="subj-grid">
          {assignments.map((assignment) => {
            const count = upcomingCountFor(assignment.academicClassId, assignment.subjectId);
            const subjectName = assignment.subject?.name ?? "Disciplina";
            const className = assignment.academicClass?.name ?? "turma";
            return (
              <li
                key={assignment.id}
                className="subj-card flex min-w-0 flex-col gap-3.5 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">{subjectName}</p>
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
            text="Sem turmas vinculadas"
            hint="Peça à administração para vincular suas disciplinas e turmas."
          />
        </div>
      )}
    </section>
  );
  const datesCard = (
    <InstitutionDatesCard
      className="duo-fill prof-dates"
      emptyText={nextOfficial ? "Nenhuma outra data da instituição à frente" : undefined}
      events={listedDates}
      subtitle={nextOfficial ? "Depois da próxima, feriados, recessos e eventos oficiais" : undefined}
      limit={mainCount}
      listed={officialListed}
      fillRef={mainGapRef}
      order={7}
      savedId={savedId}
      onOpenAll={openOfficial}
      onSelect={onSelect}
    />
  );
  const weekCard = (
    <section className="card pad rise prof-week" style={delay(7)} aria-label={weekTitle}>
      <SectionTitle title={weekTitle} subtitle={weekEmpty ? undefined : weekSubtitle(week.listed, isMine)} />
      {weekEmpty ? (
        // semana inteira livre: uma linha só. O próximo evento da docente já é o destaque logo acima; repetir
        // "Próximo: ..." aqui seria o mesmo item duas vezes seguidas (decisão 13)
        <div className="wk-empty">
          <EmptyState
            compact
            icon={CalendarDays}
            text="Semana livre"
            hint="Nenhum evento seu, das suas turmas ou da instituição nestes dias."
          />
        </div>
      ) : (
        // todos os dias da semana (Figma): "Livre" apagado no dia sem nada; hoje em destaque e os dias que já
        // passaram mais apagados
        <ul className="wk">
          {week.days.map((day) => {
            const parts = dateParts(day.date.toISOString());
            const free = !day.events.length && !day.continuing.length && !day.hidden;
            const isToday = day.key === todayKey;
            const past = day.key < todayKey;
            return (
              <li
                key={day.key}
                className={cx("wk-day", isToday && "wk-today", past && "wk-past")}
                aria-current={isToday ? "date" : undefined}
              >
                <span className="wk-label">
                  {parts.weekday} {parts.day}
                  {isToday ? <span className="wk-today-tag">Hoje</span> : null}
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
                      <span className="wk-t">
                        <span className={cx("dot", categoryMeta[event.category].accent)} aria-hidden />
                        <span className="min-w-0">{event.title}</span>
                      </span>
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
      )}
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
  );
  const mineCard = (
    <section className="card pad rise duo-fill prof-mine" style={delay(8)} aria-label="Meus próximos eventos">
      <SectionTitle title="Meus próximos eventos" />
      <EventList
        className="mt-3"
        events={listEvents}
        limit={sideCount}
        fillRef={sideGapRef}
        savedId={savedId}
        emptyCompact
        emptyIcon={CalendarPlus}
        emptyText={myOpen.length ? "Só o evento do destaque está publicado" : "Nenhum evento publicado ainda"}
        emptyHint={
          myOpen.length
            ? "Use + Evento em Minhas turmas e disciplinas para publicar o próximo."
            : "Use os atalhos das disciplinas para publicar o primeiro."
        }
        // o mesmo conjunto da aba "Próximos" da Gestão e do KPI "Publicações futuras"
        showAll={{ label: "Ver todos na Gestão", count: myOpen.length, onClick: onOpenManage, always: true }}
        onSelect={onSelect}
      />
    </section>
  );

  return (
    <div ref={rootRef} className="pnl pnl-prof grid gap-5">
      <PageHeader title={greeting} subtitle={headSubtitle || undefined} />
      <AvisosCard host avisos={avisos ?? []} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />

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
          hint={classesHint}
          actionLabel="Ver minhas turmas e disciplinas"
          onClick={openClassesCard}
        />
        <InsightTile
          icon={BookOpen}
          label="Disciplinas"
          order={4}
          value={String(assignments.length)}
          hint={term ? `no semestre ${term}` : "sem vínculo"}
          actionLabel="Ver minhas turmas e disciplinas"
          onClick={openClassesCard}
        />
        {/* a próxima data da instituição (feriado, recesso) ajuda a marcar a prova; "115 à frente" não ajudava */}
        <InsightTile
          icon={ShieldCheck}
          label="Próxima data da instituição"
          order={5}
          value={nextOfficial ? shortDayMonth(nextOfficial.startsAt) : "Nenhuma"}
          unit={nextOfficial ? yearUnit(nextOfficial.startsAt) : undefined}
          valueClassName={nextOfficial ? "is-date" : undefined}
          hint={nextOfficial ? `${nextOfficial.title}, ${relativeDue(nextOfficial.startsAt)}` : "nenhuma data da instituição à frente"}
          actionLabel="Ver as datas da instituição no cronograma"
          onClick={openOfficial}
        />
      </div>

      {/* Lado a lado: turmas e datas da instituição na coluna larga; a semana e os eventos da docente na de apoio.
          Cada coluna tem uma lista, e as duas terminam juntas pelo número de itens (useColumnFill). Numa coluna
          só (abaixo de 1280 px), o JSX já vem na ordem turmas, eventos, semana e datas: o foco do teclado e o
          leitor de tela seguem a ordem da tela */}
      <div ref={gridRef} className={cx("duo", gridClass)}>
        {wide ? (
          <>
            <div className="duo-col duo-main">
              {turmasCard}
              {datesCard}
            </div>
            <div className="duo-col duo-side">
              {weekCard}
              {mineCard}
            </div>
          </>
        ) : (
          <div className="duo-col duo-main">
            {turmasCard}
            {mineCard}
            {weekCard}
            {datesCard}
          </div>
        )}
      </div>
    </div>
  );
}
