"use client";

import { ArrowRight, Bell, BellRing, BookOpen, CalendarDays, Plus, ShieldAlert, Target, Trophy } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getMyGuardians } from "@/lib/api";
import {
  classTermLabel,
  countText,
  cx,
  formatShortDate,
  formatShortDateTime,
  shiftLabel,
} from "@/lib/format";
import { reminderOffsetLabel, reminderOptions } from "@/lib/meta";
import type { AcademicClass, AcademicContext, AcademicEvent, Category, Dashboard, GuardianLink, Reminder } from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import {
  AvisosCard,
  EventList,
  InsightTile,
  InstitutionDatesCard,
  NextEventHero,
  WeekSpark,
  calendarNote,
  calendarUpcomingCount,
  chipsSpanMonths,
  dateChip,
  delay,
  heightKey,
  isOfficialDate,
  officialCategories,
  openAhead,
  upcomingOfficialDates,
  useColumnFill,
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
import { Pager, usePaged } from "./pager";
import { Drawer, EmptyState, SectionTitle } from "./ui";

const DAY = 24 * 60 * 60 * 1000;

/** As categorias da turma (sem as do calendário oficial): o filtro que o rodapé dos compromissos abre. */
const CLASS_CATEGORIES: Category[] = ["exam", "assignment", "activity", "extracurricular"];

/** Quantas turmas o card mostra por página. */
const CLASS_LIMIT = 3;

/** "Próximos compromissos": no mínimo 4 (celular), até 8 quando a coluna ao lado é mais alta. */
const AHEAD_MIN = 4;
const AHEAD_MAX = 8;
/** "Datas da instituição": as 3 próximas, até 5 quando a outra coluna é mais alta. */
const DATES_MIN = 3;
const DATES_MAX = 5;
/**
 * Com a coluna principal mais baixa (turma sem compromissos, poucas notas), as datas da instituição descem até 1,
 * como no Painel da docente e do responsável, para as colunas terminarem juntas sem buraco no fim.
 */
const DATES_FLOOR = 1;
/** Sem turma, as datas da instituição ficam embaixo, na largura toda: as 5 próximas e o link para o resto. */
const NO_CLASS_DATES = 5;

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

/** Linha curta da turma no card "Suas turmas": "5º período, Noturno, 2026/2". */
function classMetaText(academicClass: AcademicClass) {
  return [academicClass.period, shiftLabel(academicClass.shift), classTermLabel(academicClass)].filter(Boolean).join(", ");
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
  const { notices, token, navigate, openProfile, toast } = useAppActions();
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

  const reviewTitleId = useId();
  const classTitleId = useId();

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

  // As datas oficiais da instituição (feriados, recessos, institucionais) não são compromisso da turma: elas
  // ficam só no card "Datas da instituição". O destaque, os indicadores e os compromissos olham o que é da turma.
  const classUpcoming = upcomingEvents.filter((event) => !isOfficialDate(event));
  const nextEvent = classUpcoming[0] ?? null;
  // todos os números do Painel usam a mesma janela, os próximos 30 dias, e as dicas dizem isso
  const next30 = classUpcoming.filter((event) => new Date(event.startsAt).getTime() <= now + 30 * DAY);
  const thirtyDays = next30.length;
  const exams30 = next30.filter((event) => event.category === "exam");
  const pointsAtStake = next30.reduce((sum, event) => sum + (event.points ?? 0), 0);
  // o rodapé dos compromissos abre o Cronograma só com as categorias da turma: o N é o que ele lista ali (todos os
  // próximos, não só 30 dias, com os cancelados), sem as datas da instituição, que têm o card e o link delas
  const calendarCount = calendarUpcomingCount(events, now, CLASS_CATEGORIES);
  // a lista de compromissos segue a regra das datas oficiais (openAhead): abertos com algum dia de hoje
  // em diante, o de hoje e o em andamento inclusive; o destaque continua sendo o próximo que vai começar
  const ahead = openAhead(events, now);
  const classAhead = ahead.filter((event) => !isOfficialDate(event));
  // Datas da instituição: a regra única das datas oficiais (dashboard-bits) e o Cronograma filtrado nelas
  const officialDates = upcomingOfficialDates(events, now);
  const officialListed = calendarUpcomingCount(events, now, officialCategories);
  const openOfficial = () => onOpenCalendar({ categories: officialCategories });
  // os chips das provas atravessam meses (23/11 e 02/12) ou caem todos num mês que não é o de hoje (em 28/11, só
  // provas em dezembro): o mês de hoje entra na conta, e cada chip fora dele mostra o mês e, fora do ano, o ano
  // (decisão 2)
  const chipsWithMonth = chipsSpanMonths([
    new Date(now).toISOString(),
    ...exams30.slice(0, 4).map((event) => event.startsAt),
  ]);
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

  // foco depois do "Lembrar da prova" (remindExam): o lembrete novo, quando a lista do card já o mostra; enquanto
  // não aparece, o título do card. Só se o foco ficou perdido (o botão saiu da tela junto com o vazio) ou no card
  const remindersRef = useRef<HTMLElement>(null);
  const focusReminderOf = useRef<number | null>(null);
  const scheduledKey = scheduled.map((reminder) => reminder.academicEventId).join(",");
  const focusNewReminder = useCallback(() => {
    const eventId = focusReminderOf.current;
    const card = remindersRef.current;
    if (eventId === null || !card) {
      return;
    }
    const active = document.activeElement;
    const lost = !active || active === document.body || !document.contains(active);
    const item = card.querySelector<HTMLElement>(`[data-reminder-of="${eventId}"]`);
    if (item) {
      focusReminderOf.current = null;
      if (lost || card.contains(active)) {
        item.focus({ preventScroll: true });
      }
      return;
    }
    // não deu certo, o botão continua com o foco: nada muda
    const heading = card.querySelector<HTMLElement>("h2");
    if (lost && heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, []);
  // a lista do card mudou: o lembrete novo pode ter chegado
  useEffect(() => {
    focusNewReminder();
  }, [scheduledKey, focusNewReminder]);

  // sem turma, a linha de cima tem duas colunas: o card de entrar e os lembretes. Os lembretes ficam do tamanho do
  // conteúdo, com o link logo depois do texto (sem um vão esticado até a altura do card de entrar), e param no
  // alto. As datas da instituição ficam embaixo, na largura toda. Os lembretes não sugerem datas da instituição:
  // seriam as mesmas do card de baixo (e um feriado não é compromisso para lembrar); o vazio do card só diz como
  // ativar um lembrete

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

  // avaliações que valem ponto nos 30 dias (a dica do KPI)
  const pointedCount = next30.filter((event) => event.points).length;
  // "Pontos em jogo" abre o cronograma nas categorias das avaliações que valem ponto (prova, trabalho...)
  const pointedCategories = [...new Set(next30.filter((event) => event.points).map((event) => event.category))];

  // Disciplinas da turma e seus professores, tiradas dos próprios eventos.
  const subjects = subjectsFrom(events);
  // nenhuma turma com disciplina ainda: o card "Suas turmas" explica uma vez, no rodapé
  const noSubjectYet = subjects.length === 0;

  // Lembrete do destaque: o que veio no evento ou o da lista de lembretes.
  const heroReminder = nextEvent
    ? (nextEvent.reminder ?? reminders.find((reminder) => reminder.enabled && reminder.academicEventId === nextEvent.id) ?? null)
    : null;
  const quick = nextEvent && !heroReminder ? quickOffset(nextEvent, defaultReminderMinutes, now) : null;
  // sem lembrete agendado: um clique para lembrar da próxima prova que ainda não tem
  // (a do destaque já tem o botão de lembrar nele: aqui vai a próxima, se houver)
  const examToRemind = onQuickReminder
    ? classUpcoming.find(
        (event) =>
          event.category === "exam" &&
          event.id !== nextEvent?.id &&
          !event.reminder &&
          !reminders.some((reminder) => reminder.enabled && reminder.academicEventId === event.id) &&
          quickOffset(event, defaultReminderMinutes, now) !== null
      )
    : undefined;

  // turma sem nada à frente: o destaque vazio já diz isso e leva ao Cronograma. Os indicadores todos em zero e
  // "Próximos compromissos" repetiriam o mesmo vazio, com mais um "Ver cronograma" (decisão 13): eles saem, e o
  // Painel mostra o que há. As datas da instituição vão para a coluna larga; os lembretes e as notas, para o lado
  const classIdle = !noClass && !nextEvent && classAhead.length === 0;
  // com algum lembrete agendado, os indicadores ficam (o de lembretes tem o que dizer)
  const kpisIdle = classIdle && scheduled.length === 0;

  // o card de notas carrega sozinho: quando o que ele mostra muda, as colunas refazem a conta
  const [gradesKey, setGradesKey] = useState("");
  // com turma, as duas colunas terminam juntas: os compromissos mostram de 4 (celular) a 8 itens e as datas da
  // instituição, de 3 a 5, o que couber até o fim da coluna mais alta. Com a turma parada (classIdle), a lista da
  // coluna larga é a das datas da instituição (de 1 a 5), e a coluna de apoio não tem lista
  const {
    gridRef: boardGridRef,
    mainGapRef: boardMainGapRef,
    sideGapRef: boardSideGapRef,
    mainCount: aheadCount,
    sideCount: datesCount,
    gridClass: boardGridClass,
  } = useColumnFill(
    classIdle
      ? { total: officialDates.length, min: DATES_MIN, max: DATES_MAX, floor: DATES_FLOOR }
      : { total: noClass ? 0 : classAhead.length, min: AHEAD_MIN, max: AHEAD_MAX },
    { total: noClass || classIdle ? 0 : officialDates.length, min: DATES_MIN, max: DATES_MAX, floor: DATES_FLOOR },
    [
      noClass,
      classIdle,
      heightKey(classAhead.slice(0, AHEAD_MAX)),
      heightKey(officialDates.slice(0, DATES_MAX)),
      gradesKey,
      scheduled.length,
      examToRemind?.id ?? 0,
      avisos?.length ?? 0,
      notices.length,
    ].join("|")
  );

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

  /**
   * "Lembrar da prova" do card de lembretes: depois de criar, o botão some com o vazio. O foco vai para o lembrete
   * novo na lista do card (como em Lembretes) ou, sem ele à vista, para o título do card, e não cai no fim da página.
   */
  async function remindExam(event: AcademicEvent) {
    if (!onQuickReminder) {
      return;
    }
    focusReminderOf.current = event.id;
    try {
      await onQuickReminder(event);
    } finally {
      // depois da pintura: o lembrete novo (ou o título, enquanto ele não chega); some sozinho em 3 s
      window.requestAnimationFrame(focusNewReminder);
      window.setTimeout(() => {
        if (focusReminderOf.current === event.id) {
          focusReminderOf.current = null;
        }
      }, 3000);
    }
  }

  /** Card "Próximos lembretes" (igual com e sem turma; muda só a dica do vazio), do tamanho do conteúdo. */
  function remindersCard(order: number) {
    let emptyHint = noClass ? "Abra uma data da instituição e ative um lembrete." : "Abra um evento e ative um lembrete.";
    if (examToRemind) {
      // a prova do destaque já tem o botão de lembrar nele: aqui vai a seguinte, e o texto diz que é a seguinte
      const when = formatShortDate(examToRemind.startsAt);
      emptyHint =
        nextEvent?.category === "exam"
          ? `Prova seguinte: ${examToRemind.title}, ${when}.`
          : `Próxima prova: ${examToRemind.title}, ${when}.`;
    }
    return (
      <section ref={remindersRef} className="card pad rise" style={delay(order)} aria-label="Próximos lembretes">
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
              data-reminder-of={reminder.academicEventId}
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
                  ? { label: "Lembrar da prova", onClick: () => void remindExam(examToRemind) }
                  : undefined
              }
            />
          ) : null}
        </div>
        {/* a mesma frase já está no card de avisos quando há algum */}
        {!avisos?.length && !notices.length ? (
          <p className="kpi-hint">O aviso aparece aqui e também chega no seu e-mail.</p>
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

  // mais de 3 turmas: uma página por vez (a lista não cresce no lugar)
  const classPages = usePaged(classes, CLASS_LIMIT, String(classes.length));
  const shownClasses = classPages.items;
  const classPaged = classes.length > CLASS_LIMIT;

  /** Card da turma (uma) ou das turmas (mais de uma), com o acesso discreto para entrar em outra. */
  const classCard = context ? (
    // o card termina no próprio conteúdo (xl:self-start), sem esticar até a altura do destaque com um vão entre
    // os chips e "Entrar em outra turma" (decisão 5); o destaque ao lado é que acompanha a linha
    <section
      className="card pad rise flex flex-col max-xl:order-last xl:self-start"
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
          ) : classIdle ? (
            // a turma parada: o destaque ao lado já diz "Nenhuma prova ou trabalho à frente" e leva ao Cronograma;
            // repetir o vazio aqui seria o mesmo aviso em blocos seguidos (decisão 13). O card fica com o nome, os
            // chips e "Entrar em outra turma", do tamanho do conteúdo
            null
          ) : (
            // o /context do aluno não traz as disciplinas da turma: elas saem dos eventos. Sem nenhum (mas com algo à
            // frente, como uma data sem disciplina), uma linha no lugar da lista: o card fica baixo
            <>
              <hr className="divider mt-[18px] mb-3.5" />
              <p className="aluno-class-empty-tx">
                <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
                <span>Nenhuma disciplina com prova ainda</span>
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <h2 ref={classHeadingRef} id={classTitleId} className="disp text-[24px] font-bold leading-tight" tabIndex={-1}>
            Suas turmas
          </h2>
          {/* com mais de uma página, o subtítulo diz quais turmas estão à vista ("1 a 3 de 5"): o Pager do rodapé
              fica só com as setas, para caber na mesma linha do "Entrar em outra turma" */}
          <p className="sub">
            {classPaged
              ? `${classPages.from} a ${classPages.to} de ${classes.length} turmas com matrícula ativa`
              : countText(classes.length, "turma com matrícula ativa", "turmas com matrícula ativa")}
          </p>
          {/* uma turma por linha, compacta: o nome e embaixo o período, o turno e o período letivo. O curso e as
              disciplinas ficam nas Notas e no cronograma; assim três turmas cabem sem esticar o destaque ao lado.
              Com mais de uma página, a lista guarda a altura de três linhas e a página não pula na troca */}
          <ul className={cx("aluno-classes", classPaged && "is-paged")}>
            {shownClasses.map((academicClass) => (
              <li key={academicClass.id} className="aluno-class">
                <p className="aluno-class-name" title={academicClass.name}>
                  {academicClass.name}
                </p>
                <p className="aluno-class-meta">{classMetaText(academicClass)}</p>
              </li>
            ))}
          </ul>
          {/* nenhuma turma com disciplina ainda: uma linha só, a mesma do card de uma turma, no fim da lista. Com a
              turma parada, o destaque ao lado já diz o vazio (decisão 13) e a linha sai */}
          {noSubjectYet && !classIdle ? (
            <p className="aluno-class-empty-tx aluno-classes-note">
              <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
              <span>Nenhuma disciplina com prova ainda</span>
            </p>
          ) : null}
        </>
      )}
      {pendingNotes}
      <div className="card-foot aluno-classes-foot">
        <button className="link min-h-6" onClick={() => setJoinOpen(true)} type="button">
          <Plus className="h-[15px] w-[15px]" aria-hidden />
          Entrar em outra turma
        </button>
        {classes.length > 1 ? <Pager paged={classPages} noun={["turma", "turmas"]} focusRef={classHeadingRef} /> : null}
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
      <button className="btn btn-s btn-sm shrink-0" onClick={() => openProfile("links")} type="button">
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

  // Sem matrícula ativa: o card de entrar no lugar do destaque e as datas da instituição embaixo; os lembretes ao lado
  if (noClass) {
    return (
      <div className="pnl pnl-noclass grid gap-5">
        <AvisosCard host avisos={avisos ?? []} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
        {reviewBanner}

        {/* duas colunas: entrar na turma e os lembretes (do tamanho do conteúdo, parados no alto). Embaixo, as datas
            da instituição na largura toda. No celular e no tablet, um card embaixo do outro, com as datas antes dos
            lembretes (aluno.css, .pnl-noclass). O card de entrar já explica o que falta (sem um card "Sem turma"
            repetindo a mesma orientação) */}
        <div className="duo">
          <div className="duo-col duo-main">
            <StudentJoinCard className="duo-fill" pendingEnrollments={context?.pendingEnrollments ?? []} order={0} />
          </div>
          <div className="duo-col duo-side">{remindersCard(1)}</div>
        </div>
        <InstitutionDatesCard
          events={officialDates}
          limit={NO_CLASS_DATES}
          listed={officialListed}
          order={2}
          subtitle="Valem para todos os alunos, com ou sem turma"
          onOpenAll={openOfficial}
          onSelect={onSelect}
        />
      </div>
    );
  }

  return (
    <div className="pnl grid gap-5">
      <AvisosCard host avisos={avisos ?? []} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
      {reviewBanner}

      {/* Destaque + turma (no celular e no tablet a turma vai para o fim do Painel) */}
      <div className={cx("grid items-stretch gap-5 max-xl:contents", context && "xl:grid-cols-[minmax(0,1fr)_var(--side-w)]")}>
        <div className="hero-slot rise" style={delay(0)}>
          <NextEventHero
            event={nextEvent}
            hideClass={oneClass}
            secondary={heroSecondary}
            emptyTitle="Nenhuma prova ou trabalho à frente"
            emptyText="Quando a docente publicar uma avaliação da sua turma, ela aparece aqui."
            // a data oficial da instituição fica só no card "Datas da instituição" (decisão 4)
            onOpen={onSelect}
            onEmptyAction={{ label: "Ver cronograma", onClick: () => onOpenCalendar() }}
          />
        </div>

        {classCard}
      </div>

      {/* Indicadores (todos levam ao Cronograma ou a Lembretes). Com a turma parada e nenhum lembrete, os quatro
          seriam zero logo abaixo do destaque vazio: não aparecem */}
      {kpisIdle ? null : (
        <div className="kpis">
          <InsightTile
            icon={Target}
            label="Próximos 30 dias"
            order={2}
            value={String(thirtyDays)}
            hint={thirtyDays === 1 ? "evento da turma no período" : "eventos da turma no período"}
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
                <div className="kpi-chips mt-3 flex flex-wrap gap-1.5">
                  {exams30.slice(0, 4).map((event) => (
                    <button
                      key={event.id}
                      className="pill c-prova kpi-chip"
                      aria-label={`${event.title}, ${dateChip(event.startsAt, chipsWithMonth)}`}
                      data-opens-event={event.id}
                      onClick={() => onSelect(event.id)}
                      type="button"
                    >
                      {dateChip(event.startsAt, chipsWithMonth)}
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
            actionLabel={pointedCategories.length ? "Ver as avaliações no cronograma" : "Ver no cronograma"}
            onClick={() => onOpenCalendar(pointedCategories.length ? { categories: pointedCategories } : undefined)}
            // a dica fica curta (uma linha); as disciplinas estão na barra, no nome dela e no cronograma
            hint={
              pointsBySubject.length
                ? `em ${countText(pointedCount, "avaliação", "avaliações")} nos próximos 30 dias`
                : "nenhum ponto nos próximos 30 dias"
            }
          >
            {pointsBySubject.length ? (
              <div
                className="stack mt-3 h-2"
                role="img"
                aria-label={pointsBySubject.map(([name, points]) => `${name} ${points} pontos`).join(", ")}
                title={pointsBySubject.map(([name, points]) => `${name}: ${points}`).join(", ")}
              >
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
      )}

      {/* Duas colunas que terminam juntas (useColumnFill): os compromissos da turma e as últimas notas à
          esquerda; os lembretes e as datas da instituição na coluna de apoio. A lista da coluna mais baixa
          mostra mais itens; a sobra que ficar vai para o pé do card de baixo. No celular, uma embaixo da outra */}
      {classIdle ? (
        // turma parada: as datas da instituição na coluna larga (o que há à frente) e, ao lado, os lembretes e as
        // notas. No celular, um embaixo do outro, nessa ordem
        <div ref={boardGridRef} className={cx("duo", boardGridClass)}>
          <div className="duo-col duo-main">
            <InstitutionDatesCard
              className="duo-fill"
              events={officialDates}
              limit={aheadCount}
              listed={officialListed}
              fillRef={boardMainGapRef}
              order={6}
              onOpenAll={openOfficial}
              onSelect={onSelect}
            />
          </div>
          <div className="duo-col duo-side">
            {remindersCard(7)}
            <LatestGradesCard
              className="duo-fill"
              fillRef={boardSideGapRef}
              order={8}
              onContentChange={setGradesKey}
              onSeeAll={(eventId) => navigate("grades", { eventId: eventId ?? null })}
            />
          </div>
        </div>
      ) : (
        <div ref={boardGridRef} className={cx("duo", boardGridClass)}>
          <div className="duo-col duo-main">
            <section className="card pad rise" style={delay(6)} aria-label="Próximos compromissos">
              <div className="head">
                <SectionTitle title="Próximos compromissos" subtitle="Provas, trabalhos e atividades da sua turma" />
                <button className="btn btn-s btn-sm" onClick={() => onOpenCalendar()} type="button">
                  <CalendarDays className="h-[15px] w-[15px]" aria-hidden />
                  Ver cronograma
                </button>
              </div>
              <EventList
                className="mt-3.5"
                events={classAhead}
                grouped
                hideClass={oneClass}
                limit={aheadCount}
                emptyCompact
                emptyIcon={CalendarDays}
                emptyText="Nada da turma por enquanto"
                emptyHint="Provas, trabalhos e atividades aparecem aqui e no cronograma quando a docente publicar."
                showAll={{
                  label: "Ver todos no cronograma",
                  // o N é o que o Cronograma lista com o filtro da turma (decisão 2), com os cancelados e os concluídos
                  count: calendarCount,
                  always: true,
                  onClick: () => onOpenCalendar({ categories: CLASS_CATEGORIES }),
                }}
                onSelect={onSelect}
              />
            </section>

            <LatestGradesCard
              className="duo-fill"
              fillRef={boardMainGapRef}
              order={7}
              onContentChange={setGradesKey}
              onSeeAll={(eventId) => navigate("grades", { eventId: eventId ?? null })}
            />
          </div>

          <div className="duo-col duo-side">
            {remindersCard(8)}
            <InstitutionDatesCard
              className="duo-fill"
              events={officialDates}
              limit={datesCount}
              listed={officialListed}
              fillRef={boardSideGapRef}
              order={9}
              onOpenAll={openOfficial}
              onSelect={onSelect}
            />
          </div>
        </div>
      )}

      {joinDrawer}
    </div>
  );
}
