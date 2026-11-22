"use client";

import { Bell, BellRing, CalendarDays, Clock, Info, UserPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { classPeriodLine, classTermLabel, cx, firstName, shiftLabel } from "@/lib/format";
import { gradableCategories, reminderOffsetLabel, reminderOptions } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, LinkedStudent, Reminder } from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import {
  AvisosCard,
  EventList,
  InstitutionDatesCard,
  NextEventHero,
  calendarUpcomingCount,
  delay,
  heightKey,
  officialCategories,
  openAhead,
  upcomingOfficialDates,
  useColumnFill,
  type CalendarFilter,
  type HeroAction,
} from "./dashboard-bits";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { GuardianLinkCard } from "./guardian-link-card";
import { LatestGradesCard } from "./latest-grades-card";
import { Drawer, EmptyState, SectionTitle, secondaryButton } from "./ui";

/**
 * Painel do responsável com o aluno escolhido (desenho 5.6, amostra responsavel-painel): faixa "Você acompanha
 * Diogo, TADS 5" com "O que você vê" e "Acompanhar outro aluno" (painel lateral com o GuardianLinkCard), destaque
 * da próxima prova, Próximas provas e trabalhos, Notas publicadas (LatestGradesCard com studentId) e Datas do
 * campus. Só leitura: não cria, não edita e não conclui evento; os lembretes são dele ("O lembrete chega só para
 * você."). Sem vínculo ativo, a página mostra só o GuardianLinkCard no lugar deste painel. Dona: área Responsável.
 */
export type GuardianDashboardProps = {
  /** Lembretes do próprio responsável cuja hora chegou (aviso no sistema). */
  avisos: Reminder[];
  context: AcademicContext | null;
  /** O aluno escolhido (vínculo ativo): turmas, parentesco e shareGrades. */
  student: LinkedStudent;
  defaultReminderMinutes: number;
  /** Eventos do aluno (os mesmos do Cronograma), com o lembrete do responsável. */
  events: AcademicEvent[];
  /** Lembretes do responsável, com o evento. */
  reminders: Reminder[];
  /** Algum lembrete está sendo salvo. */
  savingReminder?: boolean;
  /** Próximos eventos (do futuro, sem cancelados e concluídos), em ordem. */
  upcomingEvents: AcademicEvent[];
  onDismissAviso: (reminderId: number) => void;
  onOpenCalendar: (filter?: CalendarFilter) => void;
  /** Abre a tela Notas (com a avaliação destacada, se vier). */
  onOpenGrades: (eventId?: number) => void;
  onOpenReminders: () => void;
  /** Cria o lembrete do responsável com a antecedência padrão. */
  onQuickReminder: (event: AcademicEvent) => void | Promise<unknown>;
  /** Abre o detalhe do evento (Cronograma). */
  onSelect: (id: number) => void;
};

const DAY = 24 * 60 * 60 * 1000;

/** Até quantos itens cada lista mostra para as duas colunas terminarem juntas (useColumnFill). */
const EXAMS_MIN = 5;
const EXAMS_MAX = 10;
const DATES_MIN = 3;
const DATES_MAX = 6;
/** Lado a lado, as datas da instituição descem até 1 quando a lista de provas acaba (sem buraco no card dela). */
const DATES_FLOOR = 1;
/**
 * Nada da turma à frente (examsIdle): a grade continua com duas colunas, como com provas. As datas da instituição
 * ficam na coluna larga (a lista que acerta a altura, em duas colunas no card largo) e as notas publicadas na de apoio.
 */
const IDLE_DATES_MAX = 10;

/** Maior antecedência que ainda dá tempo de avisar, até a padrão da pessoa (a mesma conta do Painel do aluno). */
function quickOffset(event: AcademicEvent, defaultMinutes: number, now: number) {
  const start = new Date(event.startsAt).getTime();
  const options = [defaultMinutes, ...reminderOptions.map((option) => Number(option.value))]
    .filter((minutes) => minutes <= defaultMinutes)
    .sort((a, b) => b - a);
  return options.find((minutes) => start - minutes * 60000 > now) ?? null;
}

/** "Ana", "Ana e Pedro", "Ana, Pedro e Caio". */
function joinNames(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : (names[0] ?? "");
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function GuardianDashboard({
  avisos,
  defaultReminderMinutes,
  events,
  reminders,
  savingReminder,
  student,
  upcomingEvents,
  onDismissAviso,
  onOpenCalendar,
  onOpenGrades,
  onQuickReminder,
  onSelect,
}: GuardianDashboardProps) {
  const { linkedStudents, reload } = useAppActions();
  // referência de "agora" fixada na montagem (render precisa ser puro); trocar de aluno remonta o painel
  const [now] = useState(() => Date.now());
  const [dataOpen, setDataOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // avaliação do destaque cujo lembrete está sendo criado
  const [quickId, setQuickId] = useState<number | null>(null);
  // quando a página termina de salvar, some o giro (mesmo se deu erro)
  const [wasSaving, setWasSaving] = useState(Boolean(savingReminder));
  if (wasSaving !== Boolean(savingReminder)) {
    setWasSaving(Boolean(savingReminder));
    if (!savingReminder) {
      setQuickId(null);
    }
  }
  // sem promessa nem aviso da página, o giro some sozinho em 10 s
  useEffect(() => {
    if (quickId === null) {
      return;
    }
    const timer = window.setTimeout(() => setQuickId(null), 10000);
    return () => window.clearTimeout(timer);
  }, [quickId]);

  const closeLink = () => setLinkOpen(false);
  useBackLayer(linkOpen, closeLink);

  // o card de notas carrega sozinho: quando o que ele mostra muda, as colunas refazem a conta
  const [gradesKey, setGradesKey] = useState("");

  const examsTitleId = useId();
  const studentTitleId = useId();

  const name = firstName(student.fullName ?? "Aluno");
  const classes = student.classes;
  const singleClass = classes.length <= 1;
  const classNames = joinNames(classes.map((item) => item.name));
  const firstClass = classes[0] ?? null;
  const classLine = firstClass
    ? [firstClass.course?.name, classPeriodLine(firstClass)].filter(Boolean).join(", ")
    : "Sem turma ativa no momento. As datas da instituição continuam aqui.";
  const pending = linkedStudents.filter((item) => item.status === "pending");
  const pendingNames = joinNames(pending.map((item) => firstName(item.fullName ?? "Aluno")));

  // destaque: a próxima prova ou trabalho; sem nenhum, o próximo evento da turma (as datas do campus têm card próprio)
  const heroEvent =
    upcomingEvents.find((event) => gradableCategories.includes(event.category)) ??
    upcomingEvents.find((event) => event.academicClassId !== null) ??
    null;
  // sem nada à frente, o sobretítulo não promete uma "próxima prova" que o título logo abaixo nega
  const kicker = !heroEvent
    ? `Provas e trabalhos de ${name}`
    : heroEvent.category === "exam"
      ? `Próxima prova de ${name}`
      : heroEvent.category === "assignment"
        ? `Próximo trabalho de ${name}`
        : `Próximo evento de ${name}`;

  // lembrete do destaque: o que veio no evento ou o da lista de lembretes (são só do responsável)
  const heroReminder = heroEvent
    ? (heroEvent.reminder ??
      reminders.find((reminder) => reminder.enabled && reminder.academicEventId === heroEvent.id) ??
      null)
    : null;
  const quick = heroEvent && !heroReminder ? quickOffset(heroEvent, defaultReminderMinutes, now) : null;

  /** Cria o lembrete do destaque; o botão gira até a resposta e não repete o clique. */
  function remindHero(event: AcademicEvent) {
    if (quickId !== null || savingReminder) {
      return;
    }
    setQuickId(event.id);
    const result = onQuickReminder(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const done = () => setQuickId((current) => (current === event.id ? null : current));
      (result as Promise<unknown>).then(done, done);
    }
  }

  const reminderAction: HeroAction | undefined = !heroEvent
    ? undefined
    : heroReminder
      ? {
          label: `Lembrete: ${reminderOffsetLabel(heroReminder.offsetMinutes)}`,
          icon: BellRing,
          onClick: () => onSelect(heroEvent.id),
          opensEvent: heroEvent.id,
        }
      : quick
        ? {
            label: `Lembrar ${reminderOffsetLabel(quick)}`,
            icon: Bell,
            busy: quickId === heroEvent.id,
            onClick: () => remindHero(heroEvent),
          }
        : undefined;

  // Próximas provas e trabalhos: os abertos à frente nos próximos 30 dias. "Ver todos (N)": o N é o que o
  // Cronograma lista com o filtro de provas e trabalhos (com os cancelados e os de depois dos 30 dias)
  const exams30 = openAhead(events, now).filter(
    (event) => gradableCategories.includes(event.category) && new Date(event.startsAt).getTime() <= now + 30 * DAY
  );
  const examsListed = calendarUpcomingCount(events, now, gradableCategories);
  // a primeira já está no destaque: a lista logo abaixo começa pela seguinte (decisão 13). O "Ver todos (N)" segue
  // com o número do Cronograma, que lista também a do destaque
  const heroInExams = heroEvent ? exams30.some((event) => event.id === heroEvent.id) : false;
  const examsList = heroInExams ? exams30.filter((event) => event.id !== heroEvent?.id) : exams30;
  const examsLater = Math.max(0, examsListed - (heroInExams ? 1 : 0));
  // nada da turma à frente: o destaque já diz "Nenhuma prova ou trabalho à frente" e leva ao Cronograma. O card de
  // provas logo abaixo repetiria o mesmo vazio com outro "Ver cronograma" (decisão 13): ele sai, e as datas da
  // instituição ficam na coluna larga, com as notas ao lado (IDLE_DATES_MAX)
  const examsIdle = !heroEvent && exams30.length === 0;
  const openExams = () => onOpenCalendar({ categories: gradableCategories });

  // Datas do campus: a regra única das datas oficiais (dashboard-bits)
  const officialDates = upcomingOfficialDates(events, now);
  const officialListed = calendarUpcomingCount(events, now, officialCategories);
  const openOfficial = () => onOpenCalendar({ categories: officialCategories });

  // as duas colunas terminam juntas: as listas mostram mais itens enquanto a coluna delas for a mais baixa
  // sem nada da turma à frente, a lista da coluna larga é a das datas da instituição, e a de apoio (as notas) não
  // tem lista
  const { gridRef, mainGapRef, sideGapRef, mainCount, sideCount, gridClass } = useColumnFill(
    examsIdle
      ? { total: officialDates.length, min: DATES_MIN, max: IDLE_DATES_MAX, floor: DATES_FLOOR }
      : { total: examsList.length, min: EXAMS_MIN, max: EXAMS_MAX },
    { total: examsIdle ? 0 : officialDates.length, min: DATES_MIN, max: DATES_MAX, floor: DATES_FLOOR },
    [student.id, gradesKey, examsIdle, heightKey(examsList.slice(0, EXAMS_MAX)), heightKey(officialDates.slice(0, DATES_MAX))].join("|")
  );
  const examsShown = Math.min(mainCount, examsList.length);

  // o card do aluno acompanhado (o que era o cabeçalho "Você acompanha Diogo, TADS 5"): quem, a turma, o curso, o
  // período, o turno e o semestre, com os dois caminhos (o que o responsável vê e acompanhar outro aluno). Fica no
  // alto da coluna de apoio, como o card da turma no Painel do aluno
  const studentCard = (
    <section className="card pad rise pnl-class resp-student" style={delay(2)} aria-labelledby={studentTitleId}>
      <p className="resp-st-who">
        <span className="resp-st-av" aria-hidden>
          {student.initials}
        </span>
        <span className="min-w-0">
          Você acompanha <b>{name}</b>
        </span>
      </p>
      {/* nome de turma longo, sem espaço, quebra em qualquer ponto */}
      <h2 id={studentTitleId} className="pnl-class-t wrap-anywhere">
        {classNames || name}
      </h2>
      <p className="sub">{firstClass ? (firstClass.course?.name ?? classLine) : classLine}</p>
      {firstClass ? (
        <div className="pnl-chips">
          {firstClass.period ? <span className="pnl-chip">{firstClass.period}</span> : null}
          {firstClass.shift ? <span className="pnl-chip">{shiftLabel(firstClass.shift)}</span> : null}
          <span className="pnl-chip">
            {firstClass.semester ? classTermLabel(firstClass) : `Ano letivo ${firstClass.year}`}
          </span>
        </div>
      ) : null}
      <div className="card-foot resp-st-foot">
        <button className="link link-solto resp-link" onClick={() => setDataOpen(true)} type="button">
          <Info className="h-4 w-4" aria-hidden />O que você vê
        </button>
        <button className="link link-solto resp-link" onClick={() => setLinkOpen(true)} type="button">
          <UserPlus className="h-4 w-4" aria-hidden />
          Acompanhar outro aluno
        </button>
      </div>
    </section>
  );

  const until = heroEvent
    ? heroEvent.category === "assignment"
      ? "até a entrega"
      : heroEvent.category === "exam"
        ? "até a prova"
        : "até o início"
    : undefined;
  const noteId = heroEvent ? `resp-lembrete-${heroEvent.id}` : undefined;

  return (
    <div className="pnl pnl-resp grid gap-5">
      {/* o destaque é o primeiro bloco da tela (sem cabeçalho): a próxima avaliação do aluno acompanhado */}
      <div className="hero-slot rise" style={delay(0)}>
        <NextEventHero
          event={heroEvent}
          kicker={kicker}
          hideClass={singleClass}
          until={until}
          // só o lembrete do próprio responsável: nada de editar
          secondary={reminderAction ? { ...reminderAction, describedBy: noteId } : undefined}
          after={
            reminderAction ? (
              <p className="resp-hero-note" id={noteId}>
                O lembrete chega só para você.
              </p>
            ) : undefined
          }
          emptyTitle="Nenhuma prova ou trabalho à frente"
          emptyText={`Quando a docente publicar uma avaliação de ${name}, ela aparece aqui.`}
          onOpen={onSelect}
          onEmptyAction={{ label: "Ver cronograma", onClick: () => onOpenCalendar() }}
        />
      </div>

      <AvisosCard host avisos={avisos} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />

      {pending.length ? (
        <p className="callout blue rise" style={delay(1)}>
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {pending.length === 1 ? "O pedido para acompanhar" : "Os pedidos para acompanhar"} {pendingNames}{" "}
            {pending.length === 1 ? "aguarda" : "aguardam"} a secretaria. Você recebe um aviso aqui quando ela
            confirmar.
          </span>
        </p>
      ) : null}

      {examsIdle ? (
        // nada da turma à frente: as duas colunas continuam (decisão da rodada 8). As datas da instituição, o que há à
        // frente, na coluna larga, e as notas publicadas ao lado; as datas mostram o que couber até as duas fecharem
        <div ref={gridRef} className={cx("duo", gridClass)}>
          <div className="duo-col duo-main">
            <InstitutionDatesCard
              className="duo-fill"
              columns
              events={officialDates}
              limit={mainCount}
              listed={officialListed}
              fillRef={mainGapRef}
              order={2}
              onOpenAll={openOfficial}
              onSelect={onSelect}
            />
          </div>
          <div className="duo-col duo-side">
            {studentCard}
            <LatestGradesCard
              key={student.id}
              className="duo-fill"
              fillRef={sideGapRef}
              studentId={student.id}
              title="Notas publicadas"
              order={3}
              onContentChange={setGradesKey}
              onSeeAll={(eventId) => onOpenGrades(eventId)}
            />
          </div>
        </div>
      ) : (
        <div ref={gridRef} className={cx("duo", gridClass)}>
          <div className="duo-col duo-main">
            <section className="card pad rise" style={delay(2)} aria-labelledby={examsTitleId}>
              <div className="head">
                <SectionTitle
                  id={examsTitleId}
                  title="Próximas provas e trabalhos"
                  subtitle={
                    heroInExams
                      ? classNames
                        ? `Depois desta, da turma ${classNames}, nos próximos 30 dias`
                        : "Depois desta, nos próximos 30 dias"
                      : classNames
                        ? `Da turma ${classNames}, nos próximos 30 dias`
                        : "Nos próximos 30 dias"
                  }
                />
                <button className="btn btn-s btn-sm" onClick={openExams} type="button">
                  <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
                  Ver cronograma
                </button>
              </div>
              {examsList.length ? (
                <EventList
                  className="mt-3.5"
                  events={examsList}
                  grouped
                  hideClass={singleClass}
                  limit={mainCount}
                  emptyIcon={CalendarDays}
                  emptyText="Nenhuma prova ou trabalho nos próximos 30 dias"
                  // o rodapé leva ao Cronograma filtrado, que lista também o que vem depois dos 30 dias
                  showAll={{ label: "Ver todos no cronograma", count: examsListed, always: examsListed > examsShown, onClick: openExams }}
                  onSelect={onSelect}
                />
              ) : (
                // sem avaliação nos 30 dias: o vazio diz o próximo passo. O "Ver cronograma" fica só no cabeçalho do
                // card (e no destaque, quando ele também está vazio): três botões iguais na mesma tela confundiam
                <>
                  <div className="mt-3.5">
                    <EmptyState
                      compact
                      icon={CalendarDays}
                      text={
                        heroInExams
                          ? "Nenhuma outra prova ou trabalho nos próximos 30 dias"
                          : "Nenhuma prova ou trabalho nos próximos 30 dias"
                      }
                      hint={
                        examsLater
                          ? `O cronograma mostra ${plural(examsLater, "avaliação", "avaliações")} mais adiante.`
                          : "Quando a docente publicar, aparece aqui e no cronograma."
                      }
                    />
                  </div>
                </>
              )}
            </section>

            {/* as notas embaixo das provas (como no Painel do aluno): a coluna larga não fica curta ao lado das datas */}
            <LatestGradesCard
              key={student.id}
              className="duo-fill"
              fillRef={mainGapRef}
              studentId={student.id}
              title="Notas publicadas"
              order={3}
              onContentChange={setGradesKey}
              onSeeAll={(eventId) => onOpenGrades(eventId)}
            />
          </div>

          <div className="duo-col duo-side">
            {studentCard}
            <InstitutionDatesCard
              className="duo-fill"
              events={officialDates}
              limit={sideCount}
              listed={officialListed}
              fillRef={sideGapRef}
              order={4}
              onOpenAll={openOfficial}
              onSelect={onSelect}
            />
          </div>
        </div>
      )}

      <GuardianDataDialog open={dataOpen} student={student} onClose={() => setDataOpen(false)} />

      {/* acompanhar outro aluno: o mesmo formulário do Vincular aluno, no painel lateral */}
      <Drawer
        open={linkOpen}
        title="Acompanhar outro aluno"
        subtitle={`Você continua acompanhando ${name}.`}
        onClose={closeLink}
        footer={
          <button className={secondaryButton} onClick={closeLink} type="button">
            Fechar
          </button>
        }
      >
        <GuardianLinkCard
          variant="panel"
          pendingStudents={pending}
          onLinked={(result) => {
            // ativo: o painel fecha e o aviso traz "Ver agenda de ..."; pendente: o painel mostra o pedido
            if (result.link.status === "active") {
              setLinkOpen(false);
            }
            void reload();
          }}
        />
      </Drawer>
    </div>
  );
}
