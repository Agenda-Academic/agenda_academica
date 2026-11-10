"use client";

import { ArrowRight, Bell, BellRing, BookOpen, CalendarDays, Plus, ShieldAlert, Target, Trophy } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getMyGuardians } from "@/lib/api";
import { classTermLabel, countText, cx, formatShortDateTime } from "@/lib/format";
import { allCategories, reminderOffsetLabel, reminderOptions } from "@/lib/meta";
import type { AcademicClass, AcademicContext, AcademicEvent, Dashboard, GuardianLink, Reminder } from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import {
  AvisosCard,
  CategoryBreakdown,
  EventList,
  InsightTile,
  NextEventHero,
  WeekSpark,
  calendarNote,
  calendarUpcomingCount,
  dateChip,
  delay,
  openAhead,
  type CalendarFilter,
} from "./dashboard-bits";
import { LatestGradesCard } from "./latest-grades-card";
import {
  JoinCodeField,
  JoinSubmitButton,
  PendingEnrollmentNotice,
  StudentJoinCard,
  pendingList,
  useJoinClass,
} from "./student-join-card";
import { Drawer, EmptyState, SectionTitle } from "./ui";

const DAY = 24 * 60 * 60 * 1000;

/** Quantas turmas o card mostra antes do "Ver todas (N)". */
const CLASS_LIMIT = 3;

/** Maior antecedência que ainda dá tempo de avisar, até a padrão da pessoa. */
function quickOffset(event: AcademicEvent, defaultMinutes: number, now: number) {
  const start = new Date(event.startsAt).getTime();
  const options = [defaultMinutes, ...reminderOptions.map((option) => Number(option.value))]
    .filter((minutes) => minutes <= defaultMinutes)
    .sort((a, b) => b - a);
  return options.find((minutes) => start - minutes * 60000 > now) ?? null;
}

/** "Maria", "Maria e Carlos", "Maria, Carlos e José". */
function namesText(names: string[]) {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Disciplinas e docentes tirados dos próprios eventos (de uma turma, ou de todas). */
function subjectsFrom(events: AcademicEvent[], classId?: number) {
  return [
    ...new Map(
      events
        .filter((event) => event.subject && (classId === undefined || event.academicClassId === classId))
        .map((event) => [event.subject!.name, event.teacher?.fullName ?? null] as const)
    ),
  ].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
}

export function StudentDashboard({
  avisos,
  context,
  defaultReminderMinutes = 1440,
  events,
  reminders,
  savingReminder,
  upcomingEvents,
  onDismissAviso,
  onOpenCalendar,
  onOpenReminders,
  onQuickReminder,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /** Mantido por compatibilidade: os números saem dos próprios eventos. */
  dashboard?: Dashboard | null;
  defaultReminderMinutes?: number;
  events: AcademicEvent[];
  reminders: Reminder[];
  /** Algum lembrete está sendo salvo (o botão do destaque mostra o giro até terminar). */
  savingReminder?: boolean;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  onOpenCalendar: (filter?: CalendarFilter) => void;
  onOpenReminders: () => void;
  /** Cria o lembrete do destaque com a antecedência padrão, sem sair do Painel. Com promessa, o giro dura até ela terminar. */
  onQuickReminder?: (event: AcademicEvent) => void | Promise<unknown>;
  onSelect: (id: number) => void;
}) {
  const { token, navigate, openProfile, toast } = useAppActions();
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  // evento do destaque cujo lembrete está sendo criado
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

  // vínculos que o aluno precisa conferir (deixou de ser menor, desenho 6.3): aviso fixo até confirmar ou remover.
  // Volta a conferir a cada recarga da página (o perfil chama reload depois de confirmar ou remover).
  const [toReview, setToReview] = useState<GuardianLink[]>([]);
  useEffect(() => {
    let alive = true;
    getMyGuardians(token).then(
      (data) => {
        if (alive) {
          setToReview(data.guardians.filter((link) => link.needsReview && (link.status === "active" || link.status === "pending")));
        }
      },
      // o aviso é complementar: sem a lista, o Painel continua igual
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, [token, context]);

  // "Entrar em outra turma": painel lateral, com o rascunho do código guardado ao fechar
  const join = useJoinClass();
  const [joinOpen, setJoinOpen] = useState(false);
  const joinInputRef = useRef<HTMLInputElement>(null);
  const joinFormId = useId();
  function closeJoin() {
    if (!join.busy) {
      setJoinOpen(false);
    }
  }
  useBackLayer(joinOpen, closeJoin);

  async function submitJoin(event: FormEvent) {
    event.preventDefault();
    const result = await join.submit();
    if (!result) {
      joinInputRef.current?.focus();
      return;
    }
    setJoinOpen(false);
    const name = result.academicClass?.name ?? "a turma";
    toast(
      result.message ||
        (result.enrollment.status === "active"
          ? `Você entrou em ${name}.`
          : `Pedido enviado para ${name}. A docente ou a secretaria confirma.`),
      { key: "entrar-turma" }
    );
  }

  const [allClasses, setAllClasses] = useState(false);
  const reviewTitleId = useId();
  const classTitleId = useId();
  const datesTitleId = useId();

  // turmas com matrícula ativa (o Painel não supõe uma só) e pedidos ainda sem decisão
  const classes = (context?.enrollments ?? [])
    .map((enrollment) => enrollment.academicClass)
    .filter((academicClass): academicClass is AcademicClass => Boolean(academicClass));
  const pending = pendingList(context?.pendingEnrollments ?? [], null);
  const noClass = Boolean(context) && classes.length === 0;
  // com uma turma só, a linha do evento não repete a turma
  const oneClass = classes.length <= 1;

  // entrou na primeira turma pelo card: o campo sai da tela com o foco, que vai para o card da turma nova
  const classHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasNoClass = useRef(noClass);
  useEffect(() => {
    if (wasNoClass.current && !noClass) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        classHeadingRef.current?.focus({ preventScroll: true });
      }
    }
    wasNoClass.current = noClass;
  }, [noClass]);

  const nextEvent = upcomingEvents[0] ?? null;
  // todos os números do Painel usam a mesma janela, os próximos 30 dias, e as dicas dizem isso
  const next30 = upcomingEvents.filter((event) => new Date(event.startsAt).getTime() <= now + 30 * DAY);
  const thirtyDays = next30.length;
  const exams30 = next30.filter((event) => event.category === "exam");
  const pointsAtStake = next30.reduce((sum, event) => sum + (event.points ?? 0), 0);
  // o Cronograma lista todos os próximos (não só 30 dias), com os cancelados: o rodapé usa o número
  // dele e os indicadores que abrem o Cronograma dizem a diferença
  const calendarCount = calendarUpcomingCount(events, now);
  // a lista de compromissos segue a regra das datas oficiais (openAhead): abertos com algum dia de hoje
  // em diante, o de hoje e o em andamento inclusive; o destaque continua sendo o próximo que vai começar
  const ahead = openAhead(events, now);
  const thirtyNote = calendarNote(events, now, thirtyDays);
  const examsNote = calendarNote(events, now, exams30.length, { categories: ["exam"], feminine: true });
  // agendados: o aviso ainda não chegou (os que chegaram estão no card de avisos)
  const avisoIds = new Set((avisos ?? []).map((aviso) => aviso.id));
  const scheduled = reminders
    .filter(
      (reminder) =>
        reminder.enabled &&
        !avisoIds.has(reminder.id) &&
        new Date(reminder.sendAt).getTime() > now &&
        reminder.academicEvent?.status !== "cancelled" &&
        reminder.academicEvent?.status !== "completed"
    )
    .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime());

  // Pontos por disciplina nos 30 dias, para a barra do KPI.
  const pointsBySubject = Object.entries(
    next30.reduce<Record<string, number>>((acc, event) => {
      if (event.points) {
        const name = event.subject?.name ?? "Outros";
        acc[name] = (acc[name] ?? 0) + event.points;
      }
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  // Disciplinas da turma e seus professores, tiradas dos próprios eventos.
  const subjects = subjectsFrom(events);

  // Lembrete do destaque: o que veio no evento ou o da lista de lembretes.
  const heroReminder = nextEvent
    ? (nextEvent.reminder ?? reminders.find((reminder) => reminder.enabled && reminder.academicEventId === nextEvent.id) ?? null)
    : null;
  const quick = nextEvent && !heroReminder ? quickOffset(nextEvent, defaultReminderMinutes, now) : null;
  // sem lembrete agendado: um clique para lembrar da próxima prova que ainda não tem
  const examToRemind = onQuickReminder
    ? upcomingEvents.find(
        (event) =>
          event.category === "exam" &&
          !event.reminder &&
          !reminders.some((reminder) => reminder.enabled && reminder.academicEventId === event.id) &&
          quickOffset(event, defaultReminderMinutes, now) !== null
      )
    : undefined;

  /** Cria o lembrete do destaque; o botão gira até a resposta e não repete o clique. */
  function remindHero(event: AcademicEvent) {
    if (!onQuickReminder || quickId !== null || savingReminder) {
      return;
    }
    setQuickId(event.id);
    const result = onQuickReminder(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const done = () => setQuickId((current) => (current === event.id ? null : current));
      (result as Promise<unknown>).then(done, done);
    }
  }

  // os que abrem o detalhe do evento dizem qual (opensEvent), para o foco voltar a eles
  const heroSecondary = !nextEvent
    ? undefined
    : heroReminder
      ? {
          label: `Lembrete: ${reminderOffsetLabel(heroReminder.offsetMinutes)}`,
          icon: BellRing,
          onClick: () => onSelect(nextEvent.id),
          opensEvent: nextEvent.id,
        }
      : onQuickReminder
        ? quick
          ? {
              label: `Lembrar ${reminderOffsetLabel(quick)}`,
              icon: Bell,
              busy: quickId === nextEvent.id,
              onClick: () => remindHero(nextEvent),
            }
          : undefined
        : { label: "Ativar lembrete", icon: Bell, onClick: () => onSelect(nextEvent.id), opensEvent: nextEvent.id };

  /** Card "Próximos lembretes" (igual com e sem turma; muda só a dica do vazio). */
  function remindersCard(order: number) {
    let emptyHint = noClass ? "Abra uma data do campus e ative um lembrete." : "Abra um evento e ative um lembrete.";
    if (examToRemind) {
      emptyHint = `Próxima prova: ${examToRemind.title}.`;
    }
    return (
      <section className="card pad rise" style={delay(order)} aria-label="Próximos lembretes">
        {/* sem lembretes, o vazio logo abaixo já diz isso */}
        <SectionTitle
          title="Próximos lembretes"
          subtitle={
            scheduled.length
              ? `${scheduled.length} ${scheduled.length === 1 ? "lembrete agendado" : "lembretes agendados"}`
              : undefined
          }
        />
        {/* wrap-anywhere: os títulos e a dica do vazio, que traz o título da próxima prova, vêm da
            pessoa e, com palavra ou link longo, quebram em qualquer ponto */}
        <div className="mt-3.5 flex flex-col gap-2 wrap-anywhere">
          {scheduled.slice(0, 3).map((reminder) => (
            <button
              key={reminder.id}
              className="mini"
              data-opens-event={reminder.academicEventId}
              onClick={() => onSelect(reminder.academicEventId)}
              type="button"
            >
              <span className="mini-ico">
                <Bell className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0">
                {/* o título quebra linha, como no Figma (a coluna tem 330 px) */}
                <span className="mini-t block wrap-anywhere">
                  {reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}
                </span>
                {/* mesmo formato da linha em Lembretes */}
                <span className="mini-s block">
                  Aviso: {formatShortDateTime(reminder.sendAt)} ({reminderOffsetLabel(reminder.offsetMinutes)})
                </span>
              </span>
            </button>
          ))}
          {!scheduled.length ? (
            <EmptyState
              compact
              icon={Bell}
              text="Nenhum lembrete agendado"
              hint={emptyHint}
              action={
                examToRemind && onQuickReminder
                  ? { label: "Lembrar da prova", onClick: () => void onQuickReminder(examToRemind) }
                  : undefined
              }
            />
          ) : null}
        </div>
        {/* a mesma frase já está no card de avisos quando há algum */}
        {!avisos?.length ? (
          <p className="kpi-hint">O aviso aparece aqui no sistema. O envio por e-mail é o próximo passo.</p>
        ) : null}
        <div className="card-foot">
          <button className="link min-h-6" onClick={onOpenReminders} type="button">
            {scheduled.length > 3 ? `Ver todos os lembretes (${scheduled.length})` : "Gerenciar lembretes"}
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  /** Pedidos de entrada ainda sem decisão, no card da turma (quem já tem turma pediu outra). */
  const pendingNotes = pending.length ? (
    <div className="mt-4 grid gap-2">
      {pending.map((item) => (
        <PendingEnrollmentNotice key={item.id} compact academicClass={item.academicClass} now={now} sentAt={item.sentAt} />
      ))}
    </div>
  ) : null;

  /** Turma, curso e período (chips), com o período letivo sem "/0" na turma anual. */
  function classChips(academicClass: AcademicClass) {
    return (
      <div className="chips mt-3 gap-1.5">
        {academicClass.period ? <span className="pill st-ag">{academicClass.period}</span> : null}
        {academicClass.shift ? <span className="pill st-ag capitalize">{academicClass.shift}</span> : null}
        <span className="pill st-ag">{classTermLabel(academicClass)}</span>
      </div>
    );
  }

  const shownClasses = allClasses ? classes : classes.slice(0, CLASS_LIMIT);

  /** Card da turma (uma) ou das turmas (mais de uma), com o acesso discreto para entrar em outra. */
  const classCard = context ? (
    <section
      className="card pad rise flex flex-col max-xl:order-last"
      style={delay(1)}
      aria-labelledby={classTitleId}
    >
      {classes.length === 1 ? (
        <>
          {/* nome de turma longo, sem espaço, quebra em qualquer ponto */}
          <h2
            ref={classHeadingRef}
            id={classTitleId}
            className="disp text-[24px] font-bold leading-tight wrap-anywhere"
            tabIndex={-1}
          >
            {classes[0].name}
          </h2>
          <p className="sub">{classes[0].course?.name ?? "Curso"}</p>
          {classChips(classes[0])}
          {subjects.length ? (
            <>
              <hr className="divider mt-[18px] mb-3.5" />
              <ul className="flex flex-col gap-2.5 text-sm">
                {/* o nome da docente fica inteiro; só um nome que passa de 70% da linha corta com
                    reticências, para a disciplina continuar à vista e a linha não passar da borda do card */}
                {subjects.slice(0, 5).map(([subject, teacher]) => (
                  <li key={subject} className="flex justify-between gap-2.5">
                    <span className="truncate font-semibold">{subject}</span>
                    {teacher ? <span className="muted max-w-[70%] shrink-0 truncate">{teacher}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            // o /context do aluno não traz as disciplinas da turma: elas saem dos eventos. Sem nenhum, o
            // vazio diz quando chegam e leva ao Cronograma (o card não fica com o vão até o rodapé)
            <>
              <hr className="divider mt-[18px] mb-4" />
              <EmptyState
                compact
                icon={BookOpen}
                text="Nenhuma disciplina com prova ou trabalho ainda"
                hint={`As disciplinas da ${classes[0].name} aparecem aqui quando a docente marcar a primeira prova ou o primeiro trabalho.`}
                action={{ label: "Ver cronograma", onClick: () => onOpenCalendar() }}
              />
            </>
          )}
        </>
      ) : (
        <>
          <h2 ref={classHeadingRef} id={classTitleId} className="disp text-[24px] font-bold leading-tight" tabIndex={-1}>
            Suas turmas
          </h2>
          <p className="sub">{countText(classes.length, "turma com matrícula ativa", "turmas com matrícula ativa")}</p>
          <ul className="aluno-classes">
            {shownClasses.map((academicClass) => {
              const classSubjects = subjectsFrom(events, academicClass.id).map(([name]) => name);
              return (
                <li key={academicClass.id} className="aluno-class">
                  <p className="aluno-class-name wrap-anywhere">{academicClass.name}</p>
                  {academicClass.course?.name ? <p className="aluno-class-course">{academicClass.course.name}</p> : null}
                  {classChips(academicClass)}
                  <p className="aluno-class-subjects">
                    {classSubjects.length
                      ? classSubjects.join(", ")
                      : "As disciplinas aparecem aqui quando a docente marcar a primeira prova ou o primeiro trabalho."}
                  </p>
                </li>
              );
            })}
          </ul>
          {classes.length > CLASS_LIMIT ? (
            <button
              className="link mt-3 min-h-6 w-fit"
              aria-expanded={allClasses}
              onClick={() => setAllClasses((value) => !value)}
              type="button"
            >
              {allClasses ? "Mostrar menos" : `Ver todas (${classes.length})`}
            </button>
          ) : null}
        </>
      )}
      {pendingNotes}
      <div className="card-foot">
        <button className="link min-h-6" onClick={() => setJoinOpen(true)} type="button">
          <Plus className="h-[15px] w-[15px]" aria-hidden />
          Entrar em outra turma
        </button>
      </div>
    </section>
  ) : null;

  const reviewBanner = toReview.length ? (
    <section className="callout amber aluno-review rise" style={delay(0)} aria-labelledby={reviewTitleId}>
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id={reviewTitleId} className="text-[15px] font-bold">
          Confira quem acompanha sua agenda
        </h2>
        <p className="mt-0.5">
          A secretaria atualizou seu cadastro: você não é mais menor de idade. Confirme ou remova{" "}
          {toReview.length === 1 ? "o vínculo de" : "os vínculos de"}{" "}
          {namesText(toReview.map((link) => link.fullName ?? "responsável"))}. Até você decidir, ninguém vê suas notas.
        </p>
      </div>
      <button className="btn btn-s btn-sm shrink-0" onClick={openProfile} type="button">
        Conferir no perfil
      </button>
    </section>
  ) : null;

  const joinDrawer = (
    <Drawer
      open={joinOpen}
      title="Entrar em outra turma"
      subtitle="Use o código que a docente ou a secretaria passou."
      busy={join.busy}
      initialFocusRef={joinInputRef}
      onClose={closeJoin}
      footer={
        <>
          <button className="btn btn-s" onClick={closeJoin} type="button">
            Cancelar
          </button>
          <JoinSubmitButton busy={join.busy} form={joinFormId} />
        </>
      }
    >
      <form id={joinFormId} onSubmit={submitJoin} noValidate>
        <p className="text-sm leading-6 text-ink-3">
          Você continua nas turmas de agora. Com o código, as provas e os trabalhos da outra turma também aparecem no
          Painel. Se o seu e-mail não estiver na lista da turma, o pedido espera a docente ou a secretaria confirmar.
        </p>
        <div className="mt-5">
          <JoinCodeField inputRef={joinInputRef} join={join} />
        </div>
      </form>
    </Drawer>
  );

  // Sem matrícula ativa: o card de entrar no lugar do destaque, a turma vazia ao lado e as datas do campus
  if (noClass) {
    return (
      <div className="grid gap-5">
        {avisos?.length ? (
          <AvisosCard avisos={avisos} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
        ) : null}
        {reviewBanner}

        {/* no celular e no tablet o card "Sem turma" vai para o fim do Painel */}
        <div className="grid items-stretch gap-5 max-xl:contents xl:grid-cols-[minmax(0,1fr)_360px]">
          <StudentJoinCard pendingEnrollments={context?.pendingEnrollments ?? []} order={0} />
          <section className="card pad rise flex flex-col max-xl:order-last" style={delay(1)} aria-labelledby={classTitleId}>
            <h2 id={classTitleId} className="disp text-[24px] font-bold leading-tight">
              Sem turma
            </h2>
            <p className="sub">
              {pending.length
                ? "Quando a docente ou a secretaria confirmar, aparecem aqui o curso, o período e as disciplinas da turma."
                : "Com o código da turma, aparecem aqui o curso, o período e as disciplinas."}
            </p>
            <hr className="divider mt-[18px] mb-4" />
            <EmptyState compact icon={BookOpen} text="Nenhuma disciplina ainda" hint="Elas chegam junto com a turma." />
          </section>
        </div>

        <div className="board">
          <section className="card pad rise" style={delay(2)} aria-labelledby={datesTitleId}>
            <div className="head">
              <SectionTitle id={datesTitleId} title="Datas do campus" subtitle="Valem para todos os alunos, com ou sem turma." />
              <button className="btn btn-s btn-sm" onClick={() => onOpenCalendar()} type="button">
                <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
                Ver cronograma
              </button>
            </div>
            <EventList
              className="mt-3.5"
              events={ahead}
              hideClass
              limit={5}
              emptyIcon={CalendarDays}
              emptyText="Nenhuma data do campus à frente."
              emptyHint="Quando a secretaria publicar feriados e eventos do campus, eles aparecem aqui."
              showAll={{ label: "Ver todas no cronograma", count: calendarCount, onClick: () => onOpenCalendar() }}
              onSelect={onSelect}
            />
          </section>
          {remindersCard(3)}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}
      {reviewBanner}

      {/* Destaque + turma (no celular e no tablet a turma vai para o fim do Painel) */}
      <div className={cx("grid items-stretch gap-5 max-xl:contents", context && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="hero-slot rise" style={delay(0)}>
          <NextEventHero
            event={nextEvent}
            hideClass={oneClass}
            secondary={heroSecondary}
            onOpen={onSelect}
            onEmptyAction={{ label: "Ver cronograma", onClick: () => onOpenCalendar() }}
          />
        </div>

        {classCard}
      </div>

      {/* Indicadores (os clicáveis levam ao lugar certo) */}
      <div className="kpis">
        <InsightTile
          icon={Target}
          label="Próximos 30 dias"
          order={2}
          value={String(thirtyDays)}
          hint={thirtyDays === 1 ? "evento no período" : "eventos no período"}
          note={thirtyNote}
          actionLabel="Ver no cronograma"
          onClick={() => onOpenCalendar()}
        >
          <div className="-mt-10 flex justify-end">
            <WeekSpark events={next30} />
          </div>
        </InsightTile>
        <InsightTile
          icon={BookOpen}
          label="Provas à frente"
          order={3}
          value={String(exams30.length)}
          tone="c-prova"
          actionLabel="Ver as provas no cronograma"
          onClick={() => onOpenCalendar({ categories: ["exam"] })}
          hint={exams30.length ? "nos próximos 30 dias" : "nenhuma prova nos próximos 30 dias"}
          note={examsNote}
          extra={
            exams30.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {exams30.slice(0, 4).map((event) => (
                  <button
                    key={event.id}
                    className="pill c-prova kpi-chip"
                    aria-label={`${event.title}, ${dateChip(event.startsAt)}`}
                    data-opens-event={event.id}
                    onClick={() => onSelect(event.id)}
                    type="button"
                  >
                    {dateChip(event.startsAt)}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
        <InsightTile
          icon={Bell}
          label="Lembretes agendados"
          order={4}
          value={String(scheduled.length)}
          tone="c-ativ"
          actionLabel="Abrir Lembretes"
          onClick={onOpenReminders}
          hint={scheduled.length ? `próximo aviso ${formatShortDateTime(scheduled[0].sendAt)}` : "nenhum lembrete agendado"}
        />
        <InsightTile
          icon={Trophy}
          label="Pontos em jogo"
          order={5}
          value={pointsAtStake ? String(pointsAtStake) : "0"}
          unit={pointsAtStake ? "pts" : undefined}
          tone="c-extra"
          hint={
            pointsBySubject.length
              ? `nos próximos 30 dias: ${pointsBySubject.map(([name, points]) => `${name} ${points}`).join(", ")}`
              : "nenhum ponto nos próximos 30 dias"
          }
        >
          {pointsBySubject.length ? (
            <div className="stack mt-3 h-2" aria-hidden>
              {pointsBySubject.map(([name, points], index) => (
                <span
                  key={name}
                  style={{ flex: points, background: ["var(--brand)", "var(--brand-400)", "var(--brand-200)"][index % 3] }}
                />
              ))}
            </div>
          ) : null}
        </InsightTile>
      </div>

      {/* Linha do tempo à esquerda (três linhas) e apoio à direita: lembretes, últimas notas e categorias.
          A linha do tempo começa e termina junto com a coluna de apoio */}
      <div className="board aluno-board">
        <section className="card pad tall rise" style={delay(6)} aria-label="Próximos compromissos">
          <div className="head">
            <SectionTitle title="Próximos compromissos" />
            <button className="btn btn-s btn-sm" onClick={() => onOpenCalendar()} type="button">
              <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
              Ver cronograma
            </button>
          </div>
          <EventList
            className="mt-3.5"
            events={ahead}
            grouped
            hideClass={oneClass}
            limit={8}
            emptyIcon={CalendarDays}
            emptyText="Sem eventos futuros."
            emptyHint="Quando houver novos prazos, eles aparecem aqui."
            showAll={{
              label: "Ver todos no cronograma",
              // o N é o que o Cronograma lista (decisão 2), com os cancelados e os concluídos
              count: calendarCount,
              onClick: () => onOpenCalendar(),
            }}
            onSelect={onSelect}
          />
        </section>

        {remindersCard(7)}

        <LatestGradesCard order={8} onSeeAll={(eventId) => navigate("grades", { eventId: eventId ?? null })} />

        <section className="card pad rise" style={delay(9)} aria-label="Por categoria">
          <SectionTitle
            title="Por categoria"
            subtitle={`${thirtyDays} ${thirtyDays === 1 ? "evento" : "eventos"} nos próximos 30 dias`}
          />
          <div className="mt-4">
            <CategoryBreakdown
              counts={allCategories.map((category) => ({
                category,
                count: next30.filter((event) => event.category === category).length,
              }))}
              emptyText="Sem eventos nos próximos 30 dias."
            />
          </div>
        </section>
      </div>

      {joinDrawer}
    </div>
  );
}
