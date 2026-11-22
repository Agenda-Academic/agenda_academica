"use client";

import { zonedNowMs } from "@/lib/zone";
import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpen,
  CalendarDays,
  CalendarRange,
  FilePenLine,
  Loader2,
  Plus,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getMyGuardians } from "@/lib/api";
import { classTermLabel, countText, cx, formatShortDateTime, shiftLabel } from "@/lib/format";
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
  useWideLayout,
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
import { DateBadge, sendWhen } from "./reminders-view";
import { Drawer, SectionTitle } from "./ui";

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
const DATES_MAX = 6;
/**
 * Turma parada: as datas da instituição são a lista da coluna larga, ao lado da turma, dos lembretes e das notas
 * (em duas colunas no card largo, por isso até 10).
 */
const IDLE_DATES_MAX = 10;
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
  onRemindMany,
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
  /** Liga o lembrete de várias avaliações com a antecedência padrão ("Lembrar das N que faltam"). */
  onRemindMany?: (events: AcademicEvent[]) => void | Promise<unknown>;
  onSelect: (id: number) => void;
}) {
  const { notices, token, navigate, openProfile, toast } = useAppActions();
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => zonedNowMs());
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

  // foco depois do "Lembrar das que faltam" (remindMissing): o primeiro lembrete novo, quando a lista do card já o
  // mostra; enquanto não aparece, o título do card. Só se o foco ficou perdido (o botão saiu da tela) ou no card
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
  // as provas e os trabalhos dos próximos 30 dias que ainda não têm lembrete e ainda dão tempo de avisar: o card de
  // lembretes liga todos de uma vez ("Lembrar das N que faltam"), com a mesma conta da tela Lembretes
  const missing = onRemindMany
    ? next30.filter(
        (event) =>
          (event.category === "exam" || event.category === "assignment") &&
          event.status !== "cancelled" &&
          event.status !== "completed" &&
          !event.reminder &&
          !reminders.some((reminder) => reminder.academicEventId === event.id) &&
          quickOffset(event, defaultReminderMinutes, now) !== null
      )
    : [];
  const [bulkBusy, setBulkBusy] = useState(false);

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
  // lado a lado (1280 px ou mais) ou numa coluna só: sem turma, a ordem dos cards muda no JSX (o foco segue a tela)
  const wide = useWideLayout();
  const {
    gridRef: boardGridRef,
    mainGapRef: boardMainGapRef,
    sideGapRef: boardSideGapRef,
    mainCount: aheadCount,
    sideCount: datesCount,
    gridClass: boardGridClass,
  } = useColumnFill(
    classIdle
      ? { total: officialDates.length, min: DATES_MIN, max: IDLE_DATES_MAX, floor: DATES_FLOOR }
      : { total: noClass ? 0 : classAhead.length, min: AHEAD_MIN, max: AHEAD_MAX },
    { total: noClass || classIdle ? 0 : officialDates.length, min: DATES_MIN, max: DATES_MAX, floor: DATES_FLOOR },
    [
      noClass,
      classIdle,
      heightKey(classAhead.slice(0, AHEAD_MAX)),
      heightKey(officialDates.slice(0, IDLE_DATES_MAX)),
      gradesKey,
      // o card da turma fica no alto da coluna de apoio: a altura dele entra na conta
      classes.map((item) => item.id).join(","),
      subjects.length,
      pending.length,
      scheduled.length,
      missing.length,
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
   * "Lembrar das N que faltam" do card de lembretes: depois de criar, o botão some. O foco vai para o primeiro
   * lembrete novo na lista do card (como em Lembretes) ou, sem ele à vista, para o título do card, e não cai no fim
   * da página.
   */
  async function remindMissing() {
    if (!onRemindMany || !missing.length || bulkBusy || savingReminder) {
      return;
    }
    const event = [...missing].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
    focusReminderOf.current = event.id;
    setBulkBusy(true);
    try {
      await onRemindMany(missing);
    } finally {
      setBulkBusy(false);
      // depois da pintura: o lembrete novo (ou o título, enquanto ele não chega); some sozinho em 3 s
      window.requestAnimationFrame(focusNewReminder);
      window.setTimeout(() => {
        if (focusReminderOf.current === event.id) {
          focusReminderOf.current = null;
        }
      }, 3000);
    }
  }

  /**
   * Card "Próximos lembretes" (igual com e sem turma; muda só a dica do vazio), do tamanho do conteúdo. As linhas
   * seguem as da tela Lembretes: selo da data, título e quando o aviso chega ("Aviso hoje, 18:00").
   */
  function remindersCard(order: number, className?: string) {
    // as mesmas frases da tela Lembretes ("Nenhum aviso agendado", "Ligue o lembrete das provas e trabalhos que vêm
    // aí" e, sem avaliações, "Ligue o lembrete de um evento"), com e sem turma, sem "clique" nem "aqui embaixo"
    const emptyHint = "Ligue o lembrete de um evento para ser avisado antes dele.";
    const remindManyButton = (
      <button
        className="btn btn-s btn-sm al-rem-many"
        aria-busy={bulkBusy || undefined}
        aria-disabled={bulkBusy || savingReminder || undefined}
        onClick={() => void remindMissing()}
        type="button"
      >
        {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
        {missing.length === 1 ? "Lembrar da que falta" : `Lembrar das ${missing.length} que faltam`}
      </button>
    );
    return (
      <section ref={remindersRef} className={cx("card pad rise", className)} style={delay(order)} aria-label="Próximos lembretes">
        <SectionTitle
          title="Próximos lembretes"
          subtitle={scheduled.length ? countText(scheduled.length, "lembrete ligado", "lembretes ligados") : undefined}
        />
        {scheduled.length ? (
          // wrap-anywhere: os títulos vêm da pessoa e, com palavra ou link longo, quebram em qualquer ponto
          <ul className="al-rems wrap-anywhere">
            {scheduled.slice(0, 3).map((reminder) => (
              <li key={reminder.id}>
                <button
                  className="al-rem"
                  data-opens-event={reminder.academicEventId}
                  data-reminder-of={reminder.academicEventId}
                  onClick={() => onSelect(reminder.academicEventId)}
                  type="button"
                >
                  {reminder.academicEvent ? (
                    <DateBadge value={reminder.academicEvent.startsAt} now={now} />
                  ) : (
                    <span className="dbadge lb-date" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="al-rem-t">{reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}</span>
                    <span className="al-rem-s">
                      Aviso <b>{sendWhen(reminder.sendAt, now)}</b>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          // o estado vazio único (decisão 3): ícone no círculo, título, texto e a ação em btn-s btn-sm
          <div className="empty-inline compact al-rem-empty">
            <span className="empty-ico">
              <Bell aria-hidden />
            </span>
            <div className="empty-body">
              <p className="empty-t">Nenhum aviso agendado</p>
              <p className="empty-s">{missing.length ? "Ligue o lembrete das provas e trabalhos que vêm aí." : emptyHint}</p>
              {missing.length ? remindManyButton : null}
            </div>
          </div>
        )}
        {missing.length && scheduled.length ? remindManyButton : null}
        {/* a mesma frase já está no card de avisos quando há algum */}
        {!avisos?.length && !notices.length ? (
          <p className="kpi-hint">O aviso aparece aqui e também chega no seu e-mail.</p>
        ) : null}
        <div className="card-foot">
          <button className="link link-solto" onClick={onOpenReminders} type="button">
            {scheduled.length > 3 ? `Ver todos os lembretes (${scheduled.length})` : "Gerenciar lembretes"}
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  // sem cabeçalho de tela (rodada 10): a turma e o semestre que ele dizia ficam no card da turma (os chips e, com
  // mais de uma turma, a linha de cada uma); o pedido sem decisão fica no card de entrar

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
      <div className="pnl-chips">
        {academicClass.period ? <span className="pnl-chip">{academicClass.period}</span> : null}
        {academicClass.shift ? <span className="pnl-chip">{shiftLabel(academicClass.shift)}</span> : null}
        <span className="pnl-chip">
          {academicClass.semester ? classTermLabel(academicClass) : `Ano letivo ${academicClass.year}`}
        </span>
      </div>
    );
  }

  // mais de 3 turmas: uma página por vez (a lista não cresce no lugar)
  const classPages = usePaged(classes, CLASS_LIMIT, String(classes.length));
  const shownClasses = classPages.items;
  const classPaged = classes.length > CLASS_LIMIT;

  /** Card da turma (uma) ou das turmas (mais de uma), com o acesso discreto para entrar em outra. */
  const classCard = context ? (
    // no alto da coluna de apoio, do tamanho do conteúdo; o destaque fica na largura toda, sem esticar até a
    // altura deste card (antes, lado a lado, sobravam uns 50 px vazios em cima e embaixo do destaque)
    <section className="card pad rise flex flex-col pnl-class" style={delay(6)} aria-labelledby={classTitleId}>
      {classes.length === 1 ? (
        <>
          {/* nome de turma longo, sem espaço, quebra em qualquer ponto */}
          <h2 ref={classHeadingRef} id={classTitleId} className="pnl-class-t wrap-anywhere" tabIndex={-1}>
            {classes[0].name}
          </h2>
          <p className="sub">{classes[0].course?.name ?? "Curso"}</p>
          {classChips(classes[0])}
          {subjects.length ? (
            // uma disciplina por linha, com a divisória fina (amostra): a docente à direita
            <ul className="pnl-subjects">
              {/* o nome da docente fica inteiro; só um nome que passa de 70% da linha corta com
                  reticências, para a disciplina continuar à vista e a linha não passar da borda do card */}
              {subjects.slice(0, 5).map(([subject, teacher]) => (
                <li key={subject}>
                  <span className="truncate">{subject}</span>
                  {teacher ? <span className="pnl-subjects-who">{teacher}</span> : null}
                </li>
              ))}
            </ul>
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
          <h2 ref={classHeadingRef} id={classTitleId} className="pnl-class-t" tabIndex={-1}>
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
        <button className="link link-solto" onClick={() => setJoinOpen(true)} type="button">
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
    // sem foco automático no campo: ao abrir o Painel, o foco fica no começo da página (decisão da rodada 8)
    const joinCard = (
      <StudentJoinCard
        className={wide ? "duo-fill" : undefined}
        autoFocus={false}
        pendingEnrollments={context?.pendingEnrollments ?? []}
        order={0}
      />
    );
    const noClassDates = (
      <InstitutionDatesCard
        columns
        events={officialDates}
        // lado a lado (largura toda acima de 1280 px) as datas ficam em duas colunas: uma a mais fecha a última linha
        limit={wide ? NO_CLASS_DATES + 1 : NO_CLASS_DATES}
        listed={officialListed}
        order={2}
        subtitle="Valem para todos os alunos, com ou sem turma"
        onOpenAll={openOfficial}
        onSelect={onSelect}
      />
    );
    const notes = (
      <>
        <AvisosCard host avisos={avisos ?? []} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
        {reviewBanner}
      </>
    );
    return (
      <div className="pnl pnl-noclass grid gap-5">
        {/* Sem cabeçalho: o primeiro bloco é o destaque de entrar na turma (verde, como o destaque dos outros
            Painéis). Lado a lado: entrar na turma e os lembretes, que terminam na mesma linha (os dois esticam, e a
            folga dos lembretes fica antes do rodapé); embaixo, os avisos e as datas da instituição na largura toda.
            No celular e no tablet, um card embaixo do outro, já na ordem da tela no JSX: as datas vêm antes dos
            lembretes, que sem turma costumam estar vazios (o foco do teclado segue a mesma ordem). O card de entrar
            já explica o que falta (sem um card "Sem turma" repetindo a mesma orientação) */}
        {wide ? (
          <>
            <div className="duo">
              <div className="duo-col duo-main">{joinCard}</div>
              <div className="duo-col duo-side">{remindersCard(1, "duo-fill")}</div>
            </div>
            {notes}
            {noClassDates}
          </>
        ) : (
          <>
            {joinCard}
            {notes}
            {noClassDates}
            {remindersCard(1)}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="pnl grid gap-5">
      {/* Sem cabeçalho: o primeiro bloco é o destaque, na largura toda (como nos outros Painéis); os avisos e o
          aviso do vínculo vêm logo depois dele. A turma fica no alto da coluna de apoio, embaixo */}
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

      <AvisosCard host avisos={avisos ?? []} events={events} onDismiss={onDismissAviso} onOpen={onSelect} />
      {reviewBanner}

      {/* Indicadores (todos levam ao Cronograma ou a Lembretes). Com a turma parada e nenhum lembrete, os quatro
          seriam zero logo abaixo do destaque vazio: não aparecem */}
      {kpisIdle ? null : (
        <div className="kpis">
          <InsightTile
            icon={CalendarRange}
            tone="k-brand"
            label="Próximos 30 dias"
            order={2}
            value={String(thirtyDays)}
            hint={thirtyDays === 1 ? "evento da turma no período" : "eventos da turma no período"}
            actionLabel="Ver no cronograma"
            onClick={() => onOpenCalendar()}
          >
            <div className="kpi-spark">
              <WeekSpark events={next30} />
            </div>
          </InsightTile>
          <InsightTile
            icon={FilePenLine}
            tone="k-prova"
            label="Provas à frente"
            order={3}
            value={String(exams30.length)}
            actionLabel="Ver as provas no cronograma"
            onClick={() => onOpenCalendar({ categories: ["exam"] })}
            hint={exams30.length ? "nos próximos 30 dias" : "nenhuma prova nos próximos 30 dias"}
            note={examsNote}
            extra={
              exams30.length ? (
                <div className="kpi-chips mt-3 flex flex-wrap gap-x-1.5 gap-y-1">
                  {exams30.slice(0, 4).map((event) => (
                    // o botão é a área de toque (44 px no celular) e a pílula fica dentro dele
                    <button
                      key={event.id}
                      className="kpi-chip-hit"
                      aria-label={`${event.title}, ${dateChip(event.startsAt, chipsWithMonth)}`}
                      data-opens-event={event.id}
                      onClick={() => onSelect(event.id)}
                      type="button"
                    >
                      <span className="pill c-prova">{dateChip(event.startsAt, chipsWithMonth)}</span>
                    </button>
                  ))}
                  {/* no toque e no celular fica só a próxima data (painel.css): as outras viram "+N" ao lado */}
                  {exams30.length > 1 ? (
                    <span className="kpi-chips-more" aria-hidden>
                      +{exams30.length - 1}
                    </span>
                  ) : null}
                </div>
              ) : undefined
            }
          />
          <InsightTile
            icon={BellRing}
            tone="k-ipe"
            label="Lembretes agendados"
            order={4}
            value={String(scheduled.length)}
            actionLabel="Abrir Lembretes"
            onClick={onOpenReminders}
            hint={scheduled.length ? `próximo aviso ${formatShortDateTime(scheduled[0].sendAt)}` : "nenhum aviso agendado"}
          />
          <InsightTile
            icon={Trophy}
            tone="k-ok"
            label="Pontos em jogo"
            order={5}
            value={pointsAtStake ? String(pointsAtStake) : "0"}
            unit={pointsAtStake ? "pts" : undefined}
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
                className="stack pnl-bar mt-3 h-2"
                role="img"
                aria-label={pointsBySubject.map(([name, points]) => `${name} ${points} pontos`).join(", ")}
                title={pointsBySubject.map(([name, points]) => `${name}: ${points}`).join(", ")}
              >
                {/* do verde da marca ao amarelo ipê (amostra), uma cor por disciplina; a barra cresce ao entrar */}
                {pointsBySubject.map(([name, points], index) => (
                  <span
                    key={name}
                    style={{
                      flex: points,
                      background: ["var(--brand)", "var(--pnl-mid, #7aa83a)", "var(--ipe, #f2b71f)"][index % 3],
                    }}
                  />
                ))}
              </div>
            ) : null}
          </InsightTile>
        </div>
      )}

      {/* Duas colunas que terminam juntas (useColumnFill): os compromissos da turma, os lembretes e as últimas notas
          à esquerda; a turma e as datas da instituição na coluna de apoio. A lista da coluna mais baixa mostra mais
          itens; a pequena sobra que ficar vai para o card de baixo (duo-even). No celular, uma embaixo da outra */}
      {classIdle ? (
        // turma parada: as datas da instituição na coluna larga (o que há à frente) e, ao lado, os lembretes e as
        // notas. No celular, um embaixo do outro, nessa ordem
        <div ref={boardGridRef} className={cx("duo", boardGridClass)}>
          <div className="duo-col duo-main">
            <InstitutionDatesCard
              className="duo-fill"
              columns
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
            {classCard}
            {/* sem nada da turma à frente e nenhum lembrete ligado, o card de lembretes só repetiria um vazio logo
                acima do vazio das notas (e o destaque já diz que não há prova nem trabalho): ele sai, como os
                indicadores. Os lembretes continuam no menu */}
            {scheduled.length ? remindersCard(7) : null}
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

            {remindersCard(7)}

            <LatestGradesCard
              className="duo-fill"
              fillRef={boardMainGapRef}
              order={8}
              onContentChange={setGradesKey}
              onSeeAll={(eventId) => navigate("grades", { eventId: eventId ?? null })}
            />
          </div>

          <div className="duo-col duo-side">
            {classCard}
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
