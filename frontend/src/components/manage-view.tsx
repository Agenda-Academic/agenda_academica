"use client";

import { zonedNowMs } from "@/lib/zone";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Send,
  ShieldCheck,
  Target,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { getEventGrades } from "@/lib/api";
import {
  NBSP,
  countText,
  cx,
  dateParts,
  groupByWeek,
  isSameDay,
  matchesSearch,
  monthGroupLabel,
  relativeDue,
  startOfDay,
  weekdayLabels,
  yearSuffix,
} from "@/lib/format";
import { downloadTemplate } from "@/lib/grades-file";
import { categoryMeta, isGradable, showsOfficialPill } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, TeachingAssignment, UserRole } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay, isOfficialDate, openAhead, upcomingOfficialDates } from "./dashboard-bits";
import { eventLastDay, formatDayRange, reactivatedStatus } from "./event-bits";
import {
  NoAssignmentsNotice,
  activeAssignments,
  eventWhen,
  eventWhenLabel,
  type EventStatusChange,
} from "./event-editor";
import { launchedCount, subscribeGradesChanged } from "./event-grades-drawer";
import { MenuButton, RowMenu, type RowMenuItem } from "./gestao-row-menu";
import { MonthEmpty, MonthNeighbors, MonthPicker, monthBounds, monthTarget, type MonthNoun } from "./month-pager";
import { MyClasses, type MyClassesSummary } from "./my-classes";
import { Select, type SelectOption } from "./select";

/* ------------------------------------------------------------------ */
/* Abas da docente: Eventos e Minhas turmas                            */
/* ------------------------------------------------------------------ */

export type ManagePane = "events" | "classes";

const PANE_KEY = "agenda.gestao.aba";

/** Aba da Gestão da docente guardada na sessão do navegador (o F5 volta para ela). */
function readPane(): ManagePane {
  try {
    return window.sessionStorage.getItem(PANE_KEY) === "classes" ? "classes" : "events";
  } catch {
    return "events";
  }
}

function writePane(pane: ManagePane) {
  try {
    window.sessionStorage.setItem(PANE_KEY, pane);
  } catch {
    // navegação privada sem armazenamento: a aba só não fica guardada
  }
}

/** Turmas com vínculo em vigor (o mesmo que GET /classes devolve para a docente), até a lista carregar. */
function classCount(assignments: TeachingAssignment[]) {
  return new Set(assignments.filter((item) => !item.endedAt).map((item) => item.academicClassId)).size;
}

/* ------------------------------------------------------------------ */
/* Períodos, busca e ordem                                             */
/* ------------------------------------------------------------------ */

/**
 * Períodos, os mesmos do Cronograma e com a mesma regra: passado é o evento cujo último dia já passou (o de hoje
 * ainda está em Próximos). "Visão geral" (só a docente) junta o que pede ação, o que vem pela frente e o histórico.
 */
type Period = "overview" | "upcoming" | "past" | "all";
type TimeTab = Exclude<Period, "overview" | "all">;

/** Ações do menu "Mais ações" da linha. */
type RowAction = "edit" | "grades" | "sheet" | "duplicate" | "status" | "delete";

const periodLabels: Record<Period, string> = {
  overview: "Visão geral",
  upcoming: "Próximos",
  past: "Passados",
  all: "Todos",
};

/** De onde vem o evento (só a administração escolhe): as datas oficiais da instituição ou os eventos das turmas. */
type Origin = "all" | "official" | "classes";

const originLabels: Record<Origin, string> = {
  all: "Todas as origens",
  official: "Da instituição",
  classes: "Das turmas",
};

function matchesOrigin(event: AcademicEvent, origin: Origin) {
  return origin === "all" || (origin === "official") === isOfficialDate(event);
}

/** Filtro de disciplina da docente: "all", "s12" (disciplina 12) ou "none" (sem disciplina). */
const subjectKey = (event: AcademicEvent) => (event.subjectId === null ? "none" : `s${event.subjectId}`);

function mediaStore(query: string) {
  return {
    subscribe(notify: () => void) {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    read: () => window.matchMedia(query).matches,
  };
}
const onServer = () => true;
// a partir de 1440px a linha vira tabela de colunas (evento, quando, notas, ações); abaixo, cartão com o selo da data
const wideMedia = mediaStore("(min-width: 1440px)");

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const startTime = (event: AcademicEvent) => new Date(event.startsAt).getTime();
const isOpen = (event: AcademicEvent) => event.status === "scheduled" || event.status === "changed";
const isChanged = (event: AcademicEvent) => event.status === "changed" || event.status === "cancelled";

/** Próximos ou Passados pela regra do Cronograma (inPeriod): o último dia do evento já passou? */
function tabOf(event: AcademicEvent, now: number): TimeTab {
  return eventLastDay(event).getTime() < startOfDay(new Date(now)).getTime() ? "past" : "upcoming";
}

function searchText(event: AcademicEvent) {
  const meta = categoryMeta[event.category];
  return normalize(
    [
      event.title,
      event.description,
      event.subject?.name,
      event.academicClass?.name ?? "Toda a instituição",
      event.teacher?.fullName,
      event.location,
      meta.label,
      meta.short,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * A busca do menu acha o evento como no Cronograma (matchesSearch: todas as palavras, em qualquer campo, e
 * "oficial") e também pelo texto inteiro dos campos da Gestão ("Toda a instituição", o nome da categoria).
 */
function matchesTerm(event: AcademicEvent, term: string) {
  return !term || matchesSearch(event, term) || searchText(event).includes(term);
}

function rowsFor(events: AcademicEvent[], tab: Exclude<Period, "overview">, now: number) {
  const rows = tab === "all" ? [...events] : events.filter((event) => tabOf(event, now) === tab);
  // o que já passou aparece do mais recente para o mais antigo
  const newestFirst = tab === "past";
  return rows.sort((a, b) => (newestFirst ? startTime(b) - startTime(a) : startTime(a) - startTime(b)));
}

function countByTab(events: AcademicEvent[], now: number) {
  const counts = { upcoming: 0, past: 0, all: events.length };
  for (const event of events) {
    counts[tabOf(event, now)] += 1;
  }
  return counts;
}

/** Avaliação que já passou e ainda não tem as notas publicadas: entra em "Precisa de atenção". */
function needsGrades(event: AcademicEvent, now: number) {
  return isGradable(event) && event.status !== "cancelled" && tabOf(event, now) === "past" && !event.gradesPublishedAt;
}

/** "Lista de exercícios 2, Matemática e Engenharia de Software": nomes ligados por vírgula e "e". */
function joinList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Meses: a lista longa mostra um mês por vez, com o seletor de mês    */
/* ------------------------------------------------------------------ */

/** ano * 12 + mês: os meses em ordem, para comparar e andar entre eles. */
function monthOfTime(time: number) {
  const date = new Date(time);
  return date.getFullYear() * 12 + date.getMonth();
}

/** "Novembro" no ano corrente e "Janeiro de 2027" fora dele, como no Cronograma (decisão 2). */
function groupTitle(index: number) {
  return monthGroupLabel(new Date(Math.floor(index / 12), index % 12, 1));
}

/** Mês em que o evento entra na lista: o do início. Nos Próximos, o que está em andamento entra no mês de hoje. */
function monthOfEvent(event: AcademicEvent, tab: Period, todayStart: number) {
  const start = startTime(event);
  return monthOfTime(tab === "upcoming" ? Math.max(start, todayStart) : start);
}

/** As linhas (já em ordem) separadas por mês. */
function groupRowsByMonth(rows: AcademicEvent[], tab: Period, todayStart: number) {
  const months = new Map<number, AcademicEvent[]>();
  for (const event of rows) {
    const key = monthOfEvent(event, tab, todayStart);
    const list = months.get(key);
    if (list) {
      list.push(event);
    } else {
      months.set(key, [event]);
    }
  }
  return months;
}

/**
 * Mês que abre: nos Próximos, o de hoje (ou o primeiro com eventos depois dele); em Passados, o mais recente; em
 * Todos, o de hoje ou o próximo com eventos (sem nenhum à frente, o último).
 */
function defaultMonth(keys: number[], tab: Period, current: number) {
  if (!keys.length) {
    return current;
  }
  if (tab === "past") {
    return keys[keys.length - 1];
  }
  return keys.find((key) => key >= current) ?? keys[keys.length - 1];
}

const eventsText = (count: number) => countText(count, "evento", "eventos");
const EVENT_NOUN: MonthNoun = ["evento", "eventos", "nenhum evento"];

/**
 * A partir de quantos eventos a lista passa a mostrar um mês por vez. Até isso, ela mostra tudo de uma vez,
 * com o nome do mês antes do primeiro evento de cada um (2 provas em 2 meses não pedem dois cliques).
 */
const MONTH_PAGING_FROM = 10;
const MONTH_PAGING_SEARCH_FROM = 20;
/** Visão geral: quantos próximos e quantos passados recentes aparecem (o resto fica nas abas, sem expandir aqui). */
const OVERVIEW_NEXT = 5;
const OVERVIEW_PAST = 3;
/** Próximas avaliações: a janela do indicador. */
const SOON_DAYS = 30;

/** Para quem é o evento ("Matemática, TADS 5"); na administração, também quem publicou. */
function audienceOf(event: AcademicEvent, withTeacher: boolean) {
  return [
    event.subject?.name,
    event.academicClass?.name ?? "Toda a instituição",
    withTeacher && event.source === "teacher" ? event.teacher?.fullName : null,
    event.location,
  ]
    .filter(Boolean)
    .join(", ");
}

const pad = (value: number) => String(value).padStart(2, "0");
const dayMonth = (value: string | Date) => {
  const date = new Date(value);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}${yearSuffix(date)}`;
};

/**
 * Data da linha em duas partes curtas: "qui, 05/11" e "19:00 até 21:00" (ou "08:00 até 21/11"). Nas listas por mês
 * o cabeçalho do mês já diz o ano fora do ano corrente: a linha não repete (year = false). Na visão geral, sem
 * cabeçalho de mês, o ano entra fora do ano corrente.
 */
function rowWhen(event: AcademicEvent, year: boolean) {
  const when = eventWhen(event.startsAt, event.endsAt, { year });
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (when.time === "Dia todo" && when.day.includes(" a ")) {
    // período de dias inteiros no mesmo formato das listas do Painel e do Cronograma: "11 a 15/01", "30/11 a 02/12"
    const last = eventLastDay(event);
    const crossesYear = last.getFullYear() !== start.getFullYear();
    return { day: `${formatDayRange(event)}${crossesYear || (year && yearSuffix(last)) ? `/${last.getFullYear()}` : ""}`, time: when.time };
  }
  if (when.time !== "Dia todo" && end && end.getTime() > start.getTime() && !isSameDay(start, end)) {
    const crossesYear = end.getFullYear() !== start.getFullYear();
    return {
      day: when.day,
      time: `${pad(start.getHours())}:${pad(start.getMinutes())} até ${pad(end.getDate())}/${pad(end.getMonth() + 1)}${crossesYear ? `/${end.getFullYear()}` : ""}`,
    };
  }
  return when;
}

/* ------------------------------------------------------------------ */
/* Foco e destaque depois das ações                                    */
/* ------------------------------------------------------------------ */

/** Roda quando nenhum diálogo (painel ou confirmação) estiver aberto, para o foco não voltar para trás. */
function afterDialogs(run: () => void) {
  let frame = 0;
  let timer = 0;
  let tries = 0;
  const check = () => {
    tries += 1;
    if (document.querySelector('[aria-modal="true"]') && tries < 120) {
      frame = window.requestAnimationFrame(check);
      return;
    }
    timer = window.setTimeout(run, 40);
  };
  frame = window.requestAnimationFrame(check);
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fundo azul claro que some em 3 s na linha salva. */
function flashRow(row: HTMLElement) {
  const from = getComputedStyle(document.documentElement).getPropertyValue("--brand-100").trim() || "#dbeafe";
  const to = getComputedStyle(row).backgroundColor;
  row.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 3000, easing: "ease-out" });
}

/* ------------------------------------------------------------------ */
/* Situação das notas (GET /events/:id/grades, só das avaliações que pedem) */
/* ------------------------------------------------------------------ */

type GradeSummary = { students: number; launched: number };
/** Avaliações cuja situação de notas carrega de uma vez (as da atenção e as da tela). */
const SUMMARY_LIMIT = 24;

/**
 * Quantos alunos têm nota em cada avaliação pedida. Busca só o que falta, guarda o que já veio e busca de novo a
 * avaliação cujas notas mudaram na gaveta (subscribeGradesChanged).
 */
function useGradeSummaries(token: string, ids: number[]) {
  const [summaries, setSummaries] = useState<ReadonlyMap<number, GradeSummary | "error">>(() => new Map());
  const loading = useRef(new Set<number>());
  const wanted = ids.slice(0, SUMMARY_LIMIT).join(",");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !wanted) {
      return;
    }
    for (const id of wanted.split(",").map(Number)) {
      if (summaries.has(id) || loading.current.has(id)) {
        continue;
      }
      loading.current.add(id);
      getEventGrades(token, id)
        .then((grades) => ({ students: grades.counts.students, launched: launchedCount(grades.counts) }))
        .catch(() => "error" as const)
        .then((value) => {
          loading.current.delete(id);
          if (mounted.current) {
            setSummaries((current) => new Map(current).set(id, value));
          }
        });
    }
  }, [token, wanted, summaries]);

  // nota lançada, apagada, importada ou publicada na gaveta: essa avaliação é buscada de novo
  useEffect(
    () =>
      subscribeGradesChanged((id) => {
        setSummaries((current) => {
          if (!current.has(id)) {
            return current;
          }
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }),
    []
  );

  return summaries;
}

/* ------------------------------------------------------------------ */
/* Gestão                                                              */
/* ------------------------------------------------------------------ */

export type ManageViewProps = {
  canWrite: boolean;
  context: AcademicContext | null;
  role: UserRole;
  isAdmin: boolean;
  manageableEvents: AcademicEvent[];
  /** Mantido por compatibilidade: a Gestão usa só a lista dela (manageableEvents). */
  allEvents?: AcademicEvent[];
  editingEventId: number | null;
  lastSavedId?: number | null;
  savedTick?: number;
  saving?: boolean;
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onEdit: (event: AcademicEvent) => void;
  onDelete: (event: AcademicEvent) => void;
  /**
   * "Duplicar" do menu "Mais ações" (contrato 8): a página abre "Novo evento" com os dados do evento copiados e as
   * datas 7 dias depois. Sem a prop, o menu não mostra a opção.
   */
  onDuplicate?: (event: AcademicEvent) => void;
  onSetStatus?: (event: AcademicEvent, status: EventStatusChange) => void;
  /**
   * Abre as notas da avaliação (aba Notas do painel do evento), pelas ações "Lançar notas", "Publicar notas" e "Ver
   * notas" da linha (prova ou trabalho de turma; isGradable de lib/meta). A página cuida do painel. A coordenação
   * (administração) só acompanha: para ela a ação é sempre "Ver notas".
   */
  onOpenGrades?: (eventId: number) => void;
  /**
   * Texto da busca do menu (a única busca da tela): filtra a lista de eventos e, na aba "Minhas turmas"
   * (MyClasses), a lista de turmas.
   */
  search?: string;
  /** Limpa a busca do menu (o "Limpar busca" da lista vazia e o evento salvo que a busca esconderia). */
  onClearSearch?: () => void;
  /** Aba aberta (a administração fica sempre em "events"): em Minhas turmas, a busca do menu procura turmas. */
  onPaneChange?: (pane: ManagePane) => void;
  /**
   * Quantos itens a busca do menu acha na aba aberta, para o "N encontrados" do menu bater com a lista: em
   * Eventos, os eventos da origem e da disciplina em todos os períodos (o "Todos"); em Minhas turmas, as turmas.
   * null sem busca (ou enquanto a lista de turmas carrega).
   */
  onSearchCount?: (count: number | null) => void;
};

type Kpi = {
  id: string;
  label: string;
  icon: typeof CalendarDays;
  value: ReactNode;
  hint?: ReactNode;
  bar?: number;
  tone?: "attn" | "ok";
  /** Cor do quadrado do ícone (rodada 10): verde da marca, vermelho de prova, ipê, ok, azul da bandeira ou lilás. */
  ic?: "k-brand" | "k-prova" | "k-ipe" | "k-ok" | "k-azul" | "k-trab";
  /** Ainda sem os dados dele: rótulo, ícone, número e dica viram esqueleto (nada de mostrar um rótulo e trocar depois). */
  loading?: boolean;
  aria: string;
  /** O que o clique faz: troca o período e os filtros, ou abre Minhas turmas. */
  go: KpiGo;
};

type KpiGo = { period: Period; origin?: Origin; changed?: boolean } | "classes";

export function ManageView({
  canWrite,
  context,
  role,
  isAdmin,
  manageableEvents,
  editingEventId,
  lastSavedId,
  savedTick,
  saving = false,
  onNewEvent,
  onNewEventFor,
  onEdit,
  onDelete,
  onDuplicate,
  onSetStatus,
  onOpenGrades,
  search: menuSearch = "",
  onClearSearch,
  onPaneChange,
  onSearchCount,
}: ManageViewProps) {
  const { token, toast, showError, navigate } = useAppActions();
  const admin = isAdmin || role === "admin";
  const wide = useSyncExternalStore(wideMedia.subscribe, wideMedia.read, onServer);
  const headingId = useId();
  const listHeadingId = useId();
  const paneIds = { events: useId(), classes: useId() };
  // a docente tem as abas Eventos e Minhas turmas; a administração continua só com os eventos (ela tem a tela Turmas)
  const teacherTabs = !admin && role === "teacher";
  const [pane, setPane] = useState<ManagePane>(() => (teacherTabs ? readPane() : "events"));
  const [classesSummary, setClassesSummary] = useState<MyClassesSummary | null>(null);
  // erro da primeira carga da lista de turmas (onLoadError da MyClasses; volta a null quando ela recarrega): com
  // erro, o 4º indicador deixa o esqueleto na hora e mostra as turmas do contexto
  const [classesError, setClassesError] = useState<unknown>(null);
  const paneTabsRef = useRef<HTMLDivElement>(null);
  const [now] = useState(() => zonedNowMs());
  const [period, setPeriod] = useState<Period>(admin ? "upcoming" : "overview");
  // origem (administração): todas, só as datas oficiais da instituição ou só os eventos das turmas
  const [origin, setOrigin] = useState<Origin>("all");
  // disciplina (docente com duas ou mais): "all", "s12" ou "none"
  const [subject, setSubject] = useState("all");
  // indicador "Alterados ou cancelados" (administração): só os que fogem do agendado
  const [onlyChanged, setOnlyChanged] = useState(false);
  // mês escolhido, valendo para o filtro em que foi escolhido (período, origem, disciplina e busca)
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null);
  // list: a lista do momento do salvamento; a linha só é mostrada com a lista nova (ou depois de esperar)
  const [reveal, setReveal] = useState<{
    id: number;
    list: AcademicEvent[];
    waited: boolean;
    ready: boolean;
    clearSearch: boolean;
  } | null>(null);
  const [seenTick, setSeenTick] = useState(savedTick);
  const [flash, setFlash] = useState<{ id: number } | null>(null);
  const [sheetBusy, setSheetBusy] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const monthBarRef = useRef<HTMLDivElement>(null);
  const monthTitleRef = useRef<HTMLElement>(null);
  // trocou de mês pelo pé da lista (conta as trocas): o seletor do mês volta para a vista e recebe o foco
  const [monthJump, setMonthJump] = useState(0);
  // linha que pode sumir (excluir, concluir, editar): o foco vai para a vizinha (before/after). filter e
  // month: a lista em que ela estava; se a pessoa trocou de lista nesse meio-tempo, o foco não pula
  const pendingRef = useRef<{
    id: number;
    index: number;
    filter: string;
    month: number | null;
    before: number | null;
    after: number | null;
  } | null>(null);

  const assignments = context?.teachingAssignments ?? [];
  // "Novo evento de ..." só nas ofertas que aceitam evento novo (sem disciplina arquivada)
  const publishable = activeAssignments(context);
  // a busca do menu vale para os eventos só com a aba Eventos aberta (em Minhas turmas, ela procura turmas)
  const searchShown = pane === "events" ? menuSearch.trim() : "";
  const term = normalize(searchShown);
  const todayStart = startOfDay(new Date(now)).getTime();
  const currentMonth = monthOfTime(now);
  const pendingTotal = classesSummary?.pending ?? 0;

  // disciplinas da docente na lista (o filtro só aparece com duas ou mais)
  const subjectOptions: SelectOption[] = [];
  if (!admin) {
    const seen = new Map<string, { label: string; count: number }>();
    for (const event of manageableEvents) {
      const key = subjectKey(event);
      const item = seen.get(key);
      if (item) {
        item.count += 1;
      } else {
        seen.set(key, { label: event.subject?.name ?? "Sem disciplina", count: 1 });
      }
    }
    if (seen.size > 1) {
      subjectOptions.push({ value: "all", label: "Todas", count: manageableEvents.length });
      for (const [value, item] of [...seen].sort((a, b) => a[1].label.localeCompare(b[1].label, "pt-BR"))) {
        subjectOptions.push({ value, label: item.label, count: item.count });
      }
    }
  }
  const subjectFilter = subjectOptions.length && subjectOptions.some((option) => option.value === subject) ? subject : "all";

  const matchesFilters = (event: AcademicEvent, forOrigin: Origin, forSubject: string, forChanged: boolean) =>
    matchesOrigin(event, forOrigin) &&
    (forSubject === "all" || subjectKey(event) === forSubject) &&
    (!forChanged || isChanged(event));
  const filtered = (searchTerm: string, forOrigin: Origin, forSubject = subjectFilter, forChanged = onlyChanged) =>
    manageableEvents.filter(
      (event) => matchesFilters(event, forOrigin, forSubject, forChanged) && matchesTerm(event, searchTerm)
    );

  // a busca troca a visão geral por "Todos" (a visão geral não é uma lista que a busca possa estreitar)
  const shownPeriod: Exclude<Period, "overview"> | "overview" = period === "overview" && term ? "all" : period;
  const filterKey = (forPeriod: Period, forOrigin: Origin, forTerm: string) =>
    `${forPeriod}|${forOrigin}|${subjectFilter}|${onlyChanged ? 1 : 0}|${forTerm}`;

  /** O que a visão geral mostra (docente): atenção, os próximos e os passados recentes. */
  function overviewOf(events: AcademicEvent[]) {
    const attention = events.filter((event) => needsGrades(event, now)).sort((a, b) => startTime(a) - startTime(b));
    const attentionIds = new Set(attention.map((event) => event.id));
    const upcomingAll = rowsFor(events, "upcoming", now);
    const pastAll = rowsFor(events, "past", now);
    return {
      attention,
      upcoming: upcomingAll.slice(0, OVERVIEW_NEXT),
      upcomingTotal: upcomingAll.length,
      past: pastAll.filter((event) => !attentionIds.has(event.id)).slice(0, OVERVIEW_PAST),
      pastTotal: pastAll.length,
    };
  }

  // salvou (p2 avisa por savedTick): mostrar a linha salva, trocando de período, de filtro e de mês se preciso
  // (na docente, volta para a aba Eventos, que é onde a linha está)
  if (savedTick !== seenTick) {
    setSeenTick(savedTick);
    if (lastSavedId != null) {
      setReveal({ id: lastSavedId, list: manageableEvents, waited: false, ready: false, clearSearch: false });
      if (pane !== "events") {
        setPane("events");
      }
    }
  }
  if (reveal && !reveal.ready && (reveal.waited || manageableEvents !== reveal.list)) {
    const target = manageableEvents.find((event) => event.id === reveal.id);
    if (!target && reveal.waited) {
      setReveal(null);
    } else if (target) {
      // a busca do menu é da página: só dá para limpar quando ela passa o onClearSearch
      const clearSearch = Boolean(term) && !matchesTerm(target, term) && Boolean(onClearSearch);
      const keepOrigin = matchesOrigin(target, origin);
      const keepSubject = subjectFilter === "all" || subjectKey(target) === subjectFilter;
      const keepChanged = !onlyChanged || isChanged(target);
      if (!keepOrigin) {
        setOrigin("all");
      }
      if (!keepSubject) {
        setSubject("all");
      }
      if (!keepChanged) {
        setOnlyChanged(false);
      }
      const nextTerm = clearSearch ? "" : term;
      const nextSubject = keepSubject ? subjectFilter : "all";
      let targetPeriod: Period = period;
      if (period === "overview" && !nextTerm) {
        const view = overviewOf(
          manageableEvents.filter((event) => nextSubject === "all" || subjectKey(event) === nextSubject)
        );
        const inView = [...view.attention, ...view.upcoming, ...view.past].some((event) => event.id === target.id);
        if (!inView) {
          targetPeriod = tabOf(target, now);
        }
      } else if (period !== "all" && period !== "overview" && tabOf(target, now) !== period) {
        targetPeriod = tabOf(target, now);
      }
      if (targetPeriod !== period) {
        setPeriod(targetPeriod);
      }
      const keyPeriod = targetPeriod === "overview" && nextTerm ? "all" : targetPeriod;
      setPicked({
        key: `${keyPeriod}|${keepOrigin ? origin : "all"}|${nextSubject}|${keepChanged && onlyChanged ? 1 : 0}|${nextTerm}`,
        index: monthOfEvent(target, targetPeriod, todayStart),
      });
      setReveal({ ...reveal, ready: true, clearSearch });
    }
  }

  const searched = filtered(term, origin);
  const counts = countByTab(searched, now);
  const listPeriod: Exclude<Period, "overview"> = shownPeriod === "overview" ? "upcoming" : shownPeriod;
  const rows = shownPeriod === "overview" ? [] : rowsFor(searched, listPeriod, now);
  const months = groupRowsByMonth(rows, listPeriod, todayStart);
  const monthKeys = [...months.keys()].sort((a, b) => a - b);
  const currentKey = filterKey(shownPeriod, origin, term);
  // limites do seletor: de janeiro do primeiro ano a dezembro do último; Próximos começa no mês de hoje e
  // Passados termina nele
  const bounds = monthBounds(monthKeys, currentMonth);
  const minMonth = listPeriod === "upcoming" ? Math.max(bounds.min, currentMonth) : bounds.min;
  const maxMonth = listPeriod === "past" ? Math.min(bounds.max, currentMonth) : bounds.max;
  const pickedMonth = picked && picked.key === currentKey ? picked.index : null;
  const shownMonth = Math.min(maxMonth, Math.max(minMonth, pickedMonth ?? defaultMonth(monthKeys, listPeriod, currentMonth)));
  // lista curta: tudo de uma vez, separado por mês; longa: um mês por vez. A busca já estreita a lista,
  // então com ela o limite é maior
  const byMonth = shownPeriod !== "overview" && rows.length > (term ? MONTH_PAGING_SEARCH_FROM : MONTH_PAGING_FROM);
  const groups: Array<[number, AcademicEvent[]]> = byMonth ? [[shownMonth, months.get(shownMonth) ?? []]] : [...months];
  const overview = shownPeriod === "overview" ? overviewOf(searched) : null;
  const visibleRows = overview
    ? [...overview.attention, ...overview.upcoming, ...overview.past]
    : groups.flatMap(([, items]) => items);
  const rowIndex = new Map(visibleRows.map((event, index) => [event.id, index]));
  const visibleKey = visibleRows.map((event) => event.id).join(",");
  // mês na tela (null: a lista toda, curta, de uma vez) e os meses do filtro, para o foco depois de uma ação
  const pagedMonth = byMonth ? shownMonth : null;
  const monthsKey = monthKeys.join(",");
  const canCreate = admin || context === null || assignments.length > 0;
  const allOrigins = filtered(term, "all");
  const originCounts: Record<Origin, number> = {
    all: shownPeriod === "overview" ? allOrigins.length : rowsFor(allOrigins, listPeriod, now).length,
    official: rowsFor(filtered(term, "official"), listPeriod, now).length,
    classes: rowsFor(filtered(term, "classes"), listPeriod, now).length,
  };
  // a busca acha no período, mas o filtro de origem esconde (decisão 14: a tela diz quantos e oferece mostrar)
  const hiddenByOrigin = term && origin !== "all" ? originCounts.all - rows.length : 0;
  // fora do período escolhido (em qualquer origem): completa a conta do vazio com o total do menu
  const hiddenElsewhere = allOrigins.length - originCounts.all;

  // contagem da busca do menu (contrato com a página): Eventos conta o que a busca acha na tela inteira, em todas
  // as origens e todos os períodos (o filtro de origem não muda o "N encontrados" do menu; a tela diz quantos ele
  // esconde); Minhas turmas repassa o que a MyClasses achou. Só a aba aberta conta
  const [classesSearchCount, setClassesSearchCount] = useState<number | undefined>(undefined);
  const searchCount = pane === "classes" ? (classesSearchCount ?? null) : searchShown ? allOrigins.length : null;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  // situação das notas: as avaliações da atenção (todas da docente) e as da tela que já passaram sem publicar
  const summaryIds = [
    ...(teacherTabs ? manageableEvents.filter((event) => needsGrades(event, now)) : []),
    ...visibleRows.filter((event) => needsGrades(event, now)),
  ]
    .map((event) => event.id)
    .filter((id, index, list) => list.indexOf(id) === index);
  const summaries = useGradeSummaries(token, summaryIds);

  useEffect(() => {
    if (!reveal || reveal.ready || reveal.waited) {
      return;
    }
    const timer = window.setTimeout(
      () => setReveal((current) => (current && !current.ready ? { ...current, waited: true } : current)),
      1500
    );
    return () => window.clearTimeout(timer);
  }, [reveal]);

  // a linha salva não aparece com a busca do menu: a busca é limpa (fora da renderização, porque é da página)
  useEffect(() => {
    if (reveal?.clearSearch) {
      onClearSearch?.();
    }
  }, [reveal?.clearSearch, onClearSearch]);

  useEffect(() => {
    if (!reveal?.ready) {
      return;
    }
    const id = reveal.id;
    return afterDialogs(() => {
      pendingRef.current = null;
      const row = listRef.current?.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
      if (row) {
        row.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        row.querySelector<HTMLElement>("[data-edit-button]")?.focus({ preventScroll: true });
        flashRow(row);
      }
      setReveal(null);
      setFlash({ id });
    });
  }, [reveal]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || reveal || visibleKey.split(",").includes(String(pending.id))) {
      return;
    }
    const monthGone = pending.month !== null && !monthsKey.split(",").includes(String(pending.month));
    const sameView = pending.month === pagedMonth || monthGone || (pending.month !== null && pagedMonth === null);
    if (pending.filter !== currentKey || !sameView) {
      // a pessoa trocou de período, de filtro, de busca ou de mês: a linha não sumiu por causa da ação
      pendingRef.current = null;
      return;
    }
    return afterDialogs(() => {
      pendingRef.current = null;
      const list = listRef.current;
      const rowButton = (id: number | null) =>
        id === null ? null : list?.querySelector<HTMLElement>(`[data-event-id="${id}"] [data-edit-button]`);
      const buttons = list?.querySelectorAll<HTMLElement>("[data-edit-button]");
      let next = rowButton(pending.after) ?? rowButton(pending.before) ?? null;
      if (!next && buttons?.length) {
        next = buttons[Math.min(pending.index, buttons.length - 1)];
      }
      if (next) {
        next.focus();
      } else {
        (monthTitleRef.current ?? headingRef.current)?.focus();
      }
    });
  }, [visibleKey, reveal, currentKey, pagedMonth, monthsKey]);

  // mês novo pelo pé da lista: o seletor do mês volta para a vista e o leitor de tela anuncia o mês
  useEffect(() => {
    if (!monthJump) {
      return;
    }
    const bar = monthBarRef.current;
    if (bar && bar.getBoundingClientRect().top < 0) {
      bar.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    monthTitleRef.current?.focus({ preventScroll: true });
  }, [monthJump]);

  // a aba escolhida fica guardada na sessão do navegador
  useEffect(() => {
    if (teacherTabs) {
      writePane(pane);
    }
  }, [pane, teacherTabs]);

  // a página sabe qual aba está aberta (a busca do menu muda de assunto em Minhas turmas)
  useEffect(() => {
    onPaneChange?.(teacherTabs ? pane : "events");
  }, [onPaneChange, pane, teacherTabs]);

  function choosePane(next: ManagePane) {
    pendingRef.current = null;
    setPane(next);
  }

  /**
   * Indicador "Minhas turmas" e "Ver pedidos": o botão clicado some junto com a aba Eventos, então o foco vai
   * para a aba Minhas turmas (e não cai no body).
   */
  function openClasses() {
    choosePane("classes");
    window.requestAnimationFrame(() =>
      paneTabsRef.current?.querySelector<HTMLElement>('[data-pane="classes"]')?.focus(),
    );
  }

  /** Abas (WAI-ARIA): setas, Home e End trocam de aba e levam o foco junto. */
  function paneKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order: ManagePane[] = ["events", "classes"];
    const index = order.indexOf(pane);
    let next: ManagePane | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      next = order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    } else if (event.key === "Home") {
      next = order[0];
    } else if (event.key === "End") {
      next = order[order.length - 1];
    }
    if (!next) {
      return;
    }
    event.preventDefault();
    choosePane(next);
    paneTabsRef.current?.querySelector<HTMLElement>(`[data-pane="${next}"]`)?.focus();
  }

  function choosePeriod(next: Period) {
    pendingRef.current = null;
    setPeriod(next);
  }

  /** "Ver os N próximos" e o vazio "Ver em ...": troca o período e leva o foco ao botão dele. */
  function showPeriod(next: Period) {
    choosePeriod(next);
    window.requestAnimationFrame(() => segRef.current?.querySelector<HTMLElement>(`[data-period="${next}"]`)?.focus());
  }

  function chooseOrigin(next: Origin) {
    pendingRef.current = null;
    setOrigin(next);
  }

  /** Mês escolhido no seletor ou no pé da lista (fromFooter: o seletor volta para a vista). */
  function goToMonth(index: number, fromFooter = false) {
    setPicked({ key: currentKey, index });
    if (fromFooter) {
      setMonthJump((count) => count + 1);
    }
  }

  /**
   * "Limpar" do aviso da busca e "Limpar busca" da lista vazia: o botão some com a busca, então o foco vai
   * para o título da tela (sem rolar), e não para o body.
   */
  function clearSearch() {
    onClearSearch?.();
    headingRef.current?.focus({ preventScroll: true });
  }

  /** "Ver todas as origens" do aviso de lista vazia. */
  function showAllOrigins() {
    chooseOrigin("all");
    headingRef.current?.focus();
  }

  /** Indicador clicado: aplica o filtro dele (administração) e volta ao mês de partida. */
  function applyKpi(next: Exclude<KpiGo, "classes">) {
    pendingRef.current = null;
    setPeriod(next.period);
    setOrigin(next.origin ?? "all");
    // o número do indicador não olha a disciplina: a lista aberta precisa bater com ele
    setSubject("all");
    setOnlyChanged(Boolean(next.changed));
    setPicked(null);
    listRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  /**
   * Guarda a linha da ação e as vizinhas dela na lista (de todos os meses): se a linha sumir, o foco vai para a
   * de baixo ou a de cima.
   */
  function markPending(event: AcademicEvent, index: number) {
    const order = overview ? visibleRows : rows;
    const position = order.findIndex((row) => row.id === event.id);
    pendingRef.current = {
      id: event.id,
      index,
      filter: currentKey,
      month: pagedMonth,
      before: position > 0 ? order[position - 1].id : null,
      after: position >= 0 && position < order.length - 1 ? order[position + 1].id : null,
    };
  }

  function edit(event: AcademicEvent, index: number) {
    markPending(event, index);
    onEdit(event);
  }

  function remove(event: AcademicEvent, index: number) {
    markPending(event, index);
    onDelete(event);
  }

  function changeStatus(event: AcademicEvent, status: EventStatusChange, index: number) {
    if (saving || !onSetStatus) {
      return;
    }
    markPending(event, index);
    onSetStatus(event, status);
  }

  /** "Baixar planilha": a planilha da turma com os alunos ativos, pronta para escrever as notas. */
  async function downloadSheet(event: AcademicEvent) {
    if (sheetBusy !== null) {
      return;
    }
    setSheetBusy(event.id);
    try {
      const grades = await getEventGrades(token, event.id);
      const students = grades.students
        .filter((student) => student.enrollmentStatus === "active")
        .map((student) => ({ email: student.email, fullName: student.fullName, registration: student.registration }));
      await downloadTemplate(grades.event, students);
      // a coordenação baixa para conferir: o "envie em Lançar notas" é só da docente
      toast(
        students.length
          ? `Planilha de ${event.title} baixada com ${countText(students.length, "aluno", "alunos")}.${admin ? "" : " Depois de preencher, envie em Lançar notas."}`
          : `Planilha de ${event.title} baixada. A turma ainda não tem alunos ativos.`,
        { tone: "info", key: "gestao-planilha" }
      );
    } catch (error) {
      showError(error, "gestao-planilha");
    } finally {
      setSheetBusy(null);
    }
  }

  if (!canWrite) {
    return (
      <section className="card pad rise flex flex-col items-start">
        <span className="empty-ico">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="h2 mt-4">Gestão docente</h2>
        <p className="sub max-w-xl">
          Seu perfil pode visualizar eventos e configurar lembretes. A criação e a alteração de eventos ficam com
          docentes e com a administração.
        </p>
      </section>
    );
  }

  const noAssignments = !admin && context !== null && assignments.length === 0;
  if (noAssignments && !manageableEvents.length) {
    return (
      <section className="card pad rise">
        <NoAssignmentsNotice heading="h2" />
      </section>
    );
  }

  const activeLabel = periodLabels[shownPeriod];
  const otherTab = (["upcoming", "past"] as const).find((item) => item !== shownPeriod && counts[item] > 0);
  const originNote = origin === "official" ? "só as datas da instituição" : origin === "classes" ? "só os das turmas" : null;
  const shownTitle = groupTitle(shownMonth);

  /* ---------- situação das notas e ações da linha ---------- */

  type GradeState =
    | { kind: "none" }
    | { kind: "later" }
    | { kind: "published"; at: string }
    | { kind: "progress"; summary: GradeSummary | null };

  function gradeState(event: AcademicEvent): GradeState {
    if (!isGradable(event) || event.status === "cancelled") {
      return { kind: "none" };
    }
    if (tabOf(event, now) === "upcoming") {
      return { kind: "later" };
    }
    if (event.gradesPublishedAt) {
      return { kind: "published", at: event.gradesPublishedAt };
    }
    const summary = summaries.get(event.id);
    return { kind: "progress", summary: summary && summary !== "error" ? summary : null };
  }

  const fullyLaunched = (summary: GradeSummary | null) =>
    Boolean(summary && summary.students > 0 && summary.launched >= summary.students);

  /**
   * Ação das notas na linha: "Lançar notas", "Publicar notas" ou "Ver notas" (só avaliação que já passou). A
   * coordenação não lança nem publica: para ela é sempre "Ver notas".
   */
  function gradeAction(event: AcademicEvent) {
    if (!onOpenGrades) {
      return null;
    }
    const state = gradeState(event);
    if (state.kind === "published" || (admin && state.kind === "progress")) {
      return { label: "Ver notas", icon: ClipboardCheck, publish: false };
    }
    if (state.kind === "progress") {
      return fullyLaunched(state.summary)
        ? { label: "Publicar notas", icon: Send, publish: true }
        : { label: "Lançar notas", icon: ClipboardCheck, publish: false };
    }
    return null;
  }

  function stateCell(event: AcademicEvent) {
    const state = gradeState(event);
    if (state.kind === "later") {
      return <span className="gx-nt">{event.category === "exam" ? "Notas depois da prova" : "Notas depois da entrega"}</span>;
    }
    if (state.kind === "published") {
      return (
        <span className="stat green">
          <CheckCircle2 aria-hidden />
          {`Publicadas em ${dayMonth(state.at)}`}
        </span>
      );
    }
    if (state.kind === "progress") {
      const summary = state.summary;
      if (!summary) {
        return <span className="gx-nt">Notas não publicadas</span>;
      }
      const full = fullyLaunched(summary);
      const ratio = summary.students ? Math.min(1, summary.launched / summary.students) : 0;
      return (
        <div className="gx-prog">
          <div className="gx-prog-l">
            <span>
              <b>{`${summary.launched} de ${summary.students}`}</b> com nota
            </span>
            {full ? (
              <span className="stat amber">
                <EyeOff aria-hidden />
                Ocultas
              </span>
            ) : null}
          </div>
          <span className={cx("gx-bar", summary.launched === 0 && "zero")} aria-hidden>
            <i style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        </div>
      );
    }
    return null;
  }

  function titlePills(event: AcademicEvent) {
    const pills: ReactNode[] = [];
    if (flash?.id === event.id) {
      pills.push(
        <span key="salvo" className="stat blue">
          <CheckCircle2 aria-hidden />
          Salvo agora
        </span>
      );
    } else if (editingEventId === event.id) {
      pills.push(
        <span key="edicao" className="stat blue">
          <Pencil aria-hidden />
          Em edição
        </span>
      );
    }
    if (event.status === "changed") {
      pills.push(
        <span key="st" className="stat amber">
          Alterado
        </span>
      );
    } else if (event.status === "cancelled") {
      pills.push(
        <span key="st" className="stat red">
          Cancelado
        </span>
      );
    } else if (event.status === "completed") {
      pills.push(
        <span key="st" className="stat green">
          Concluído
        </span>
      );
    }
    if (admin && showsOfficialPill(event)) {
      pills.push(
        <span key="of" className="stat blue">
          <ShieldCheck aria-hidden />
          Oficial
        </span>
      );
    }
    return pills;
  }

  /** "18:00, amanhã" (tom âmbar hoje e amanhã); na atenção, "há 4 dias" em âmbar; no passado, só a hora. */
  function whenLine(event: AcademicEvent, attention: boolean, year: boolean) {
    const when = rowWhen(event, year);
    const past = tabOf(event, now) === "past";
    if (past) {
      return { day: when.day, sub: attention ? relativeDue(event.startsAt) : when.time, soon: attention };
    }
    const started = startTime(event) < todayStart;
    const rel = started ? "em andamento" : relativeDue(event.startsAt);
    const soon = rel === "hoje" || rel === "amanhã" || started;
    return { day: when.day, sub: `${when.time}, ${rel}`, soon };
  }

  function menuItems(event: AcademicEvent, { editButton, sheetButton }: { editButton: boolean; sheetButton: boolean }) {
    const items: RowMenuItem<RowAction>[] = [];
    if (!editButton) {
      items.push({ id: "edit", label: "Editar", icon: Pencil });
    }
    if (onOpenGrades && isGradable(event) && !gradeAction(event)) {
      items.push({ id: "grades", label: "Notas", icon: ClipboardCheck });
    }
    if (onOpenGrades && isGradable(event) && !sheetButton) {
      items.push({ id: "sheet", label: "Baixar planilha", icon: Download, disabled: sheetBusy !== null });
    }
    if (onDuplicate) {
      items.push({ id: "duplicate", label: "Duplicar", icon: Copy });
    }
    // datas da instituição (feriado, recesso, institucional) não se "concluem": passam sozinhas para Passados.
    // Uma que já esteja concluída continua com "Reativar", para desfazer
    const open = isOpen(event);
    if (onSetStatus && !(open && isOfficialDate(event))) {
      items.push({
        id: "status",
        label: open ? "Concluir" : "Reativar",
        icon: open ? CheckCircle2 : RotateCcw,
        disabled: saving,
      });
    }
    items.push({ id: "delete", label: "Excluir", icon: Trash2, tone: "danger" });
    return items;
  }

  function runAction(event: AcademicEvent, index: number, action: RowAction) {
    if (action === "edit") {
      edit(event, index);
    } else if (action === "grades") {
      onOpenGrades?.(event.id);
    } else if (action === "sheet") {
      void downloadSheet(event);
    } else if (action === "duplicate") {
      onDuplicate?.(event);
    } else if (action === "status") {
      changeStatus(event, isOpen(event) ? "completed" : reactivatedStatus(event), index);
    } else {
      remove(event, index);
    }
  }

  /** A linha inteira abre o editor (mouse); os botões e o menu dentro dela ficam com o clique deles. */
  function rowClick(event: AcademicEvent, index: number) {
    return (click: ReactMouseEvent<HTMLLIElement>) => {
      if ((click.target as HTMLElement).closest("button, a, input, [role='menu']")) {
        return;
      }
      edit(event, index);
    };
  }

  /**
   * Linha do evento, a mesma nas seções e nas abas. A partir de 1440px: evento (título, categoria e para quem),
   * quando, notas e ações rotuladas. Abaixo: cartão com o selo da data, o título (que abre o editor) e a ação das
   * notas em botão largo; o resto no menu de três pontos.
   */
  function eventRow(event: AcademicEvent, { attention = false, year = false } = {}) {
    const index = rowIndex.get(event.id) ?? 0;
    const meta = categoryMeta[event.category];
    const parts = dateParts(event.startsAt);
    const editing = editingEventId === event.id;
    const cancelled = event.status === "cancelled";
    const closed = cancelled || event.status === "completed";
    const when = whenLine(event, attention, year);
    const action = gradeAction(event);
    const audience = audienceOf(event, admin);
    const sheetButton = attention && Boolean(action) && !action?.publish;
    // na atenção, a ação das notas é a principal; "Baixar planilha" ou "Ver notas" ao lado
    const secondary = attention && action ? (
      action.publish ? (
        <button className="btn btn-s btn-sm" onClick={() => onOpenGrades?.(event.id)} type="button">
          Ver notas
        </button>
      ) : (
        <button
          className="btn btn-s btn-sm"
          aria-busy={sheetBusy === event.id || undefined}
          aria-label={`Baixar planilha de ${event.title}`}
          onClick={() => void downloadSheet(event)}
          type="button"
        >
          {sheetBusy === event.id ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          Baixar planilha
        </button>
      )
    ) : null;
    // "Editar" rotulado na linha: na tabela, sempre (fora da atenção); no cartão (abaixo de 1440), quando a linha não
    // tem ação de notas, para a ação principal nunca ficar só no "..." (aí o título é texto e o botão abre o editor)
    const editButton = !attention && (wide || !action);
    const titleButton = !wide && !editButton;
    const actionButton = action ? (
      <button
        className={cx("btn btn-sm gx-act", attention ? "btn-p" : "btn-s")}
        data-edit-button={attention && wide ? "" : undefined}
        aria-haspopup="dialog"
        aria-label={`${action.label} de ${event.title}`}
        onClick={() => onOpenGrades?.(event.id)}
        type="button"
      >
        {action.publish ? <Send className="h-4 w-4" aria-hidden /> : null}
        {action.label}
      </button>
    ) : null;
    const pills = titlePills(event);
    return (
      <li
        key={event.id}
        data-event-id={event.id}
        data-editing={editing ? "" : undefined}
        aria-current={editing ? "true" : undefined}
        className={cx("gx-row", closed && "closed", editing && "editing")}
        onClick={rowClick(event, index)}
      >
        <span className={cx("dbadge gx-date", tabOf(event, now) === "upcoming" && startTime(event) < todayStart + 86400000 && "today")} aria-hidden>
          <small>{parts.weekday}</small>
          <b>{parts.day}</b>
        </span>
        <div className="gx-main">
          <div className="gx-t">
            {!titleButton ? (
              <span className={cx("gx-title", cancelled && "line-through")}>{event.title}</span>
            ) : (
              <button
                className={cx("gx-title gx-title-btn", cancelled && "line-through")}
                data-edit-button=""
                aria-label={`Editar ${event.title}, ${eventWhenLabel(event.startsAt, event.endsAt)}, ${audience}`}
                onClick={() => edit(event, index)}
                type="button"
              >
                {event.title}
              </button>
            )}
            {pills.length ? <span className="gx-pills">{pills}</span> : null}
          </div>
          <div className="gx-m">
            <span className={cx("cat", meta.tint)}>{meta.short}</span>
            <span className="gx-aud">{wide ? audience : [audience, when.sub].filter(Boolean).join(", ").replace(/ (\d)/g, `${NBSP}$1`)}</span>
          </div>
        </div>
        <div className="gx-when">
          <b className={cx(cancelled && "line-through")}>{when.day}</b>
          <span className={cx(when.soon && "soon")}>{when.sub}</span>
        </div>
        <div className="gx-state">{stateCell(event)}</div>
        <div className="gx-acts">
          {secondary}
          {actionButton}
          {editButton ? (
            <button
              className="btn btn-s btn-sm gx-edit"
              data-edit-button=""
              aria-label={`Editar ${event.title}`}
              onClick={() => edit(event, index)}
              type="button"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Editar
            </button>
          ) : null}
        </div>
        <div className="gx-more">
          <RowMenu
            label={`Mais ações de ${event.title}`}
            items={menuItems(event, { editButton, sheetButton })}
            onSelect={(id) => runAction(event, index, id)}
          />
        </div>
      </li>
    );
  }

  /* ---------- cabeçalho, indicadores e filtros ---------- */

  // "Novo evento" com a seta "Para qual disciplina?" (as ofertas com evento novo); com uma só, o botão já basta
  const offerItems: RowMenuItem<string>[] = publishable
    .filter((item, index, list) => list.findIndex((other) => other.academicClassId === item.academicClassId && other.subjectId === item.subjectId) === index)
    .map((item) => ({
      id: `${item.academicClassId}:${item.subjectId}`,
      label: item.subject?.name ?? "Disciplina",
      description: [item.academicClass?.name, item.academicClass?.shift ? item.academicClass.shift.charAt(0).toUpperCase() + item.academicClass.shift.slice(1) : null]
        .filter(Boolean)
        .join(", "),
      icon: BookOpen,
    }));
  const newLabel = admin ? "Novo evento oficial" : "Novo evento";
  const headerActions = canCreate ? (
    admin ? (
      <>
        <button className="btn btn-s" onClick={() => navigate("sync")} type="button">
          <Upload className="h-4 w-4" aria-hidden />
          Importar calendário
        </button>
        <button className="btn btn-p" onClick={onNewEvent} type="button">
          <Plus className="h-4 w-4" aria-hidden />
          {newLabel}
        </button>
      </>
    ) : offerItems.length > 1 ? (
      <div className="split">
        <button className="btn btn-p" onClick={onNewEvent} type="button">
          <Plus className="h-4 w-4" aria-hidden />
          {newLabel}
        </button>
        <MenuButton
          label="Novo evento para uma disciplina"
          title="Escolher a disciplina"
          heading="Para qual disciplina?"
          triggerClassName="btn btn-p"
          trigger={<ChevronDown className="h-4 w-4" aria-hidden />}
          minWidth={300}
          items={offerItems}
          onSelect={(id) => {
            const [classId, subjectId] = id.split(":").map(Number);
            onNewEventFor(classId, subjectId);
          }}
        />
      </div>
    ) : (
      <button className="btn btn-p" onClick={onNewEvent} type="button">
        <Plus className="h-4 w-4" aria-hidden />
        {newLabel}
      </button>
    )
  ) : null;

  // rodada 10: sem cabeçalho de página (o nome da tela já está no trilho). O título fica só para leitor de tela e
  // continua recebendo o foco ao limpar a busca; as ações vão para a linha das abas (docente) ou dos filtros
  const header = (
    <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
      {admin ? "Eventos da instituição" : "Gestão"}
    </h2>
  );

  // indicadores (amostra A): clicáveis, cada um leva ao que conta
  const soonLimit = todayStart + SOON_DAYS * 86400000;
  const kpis: Kpi[] = [];
  const attentionAll = manageableEvents.filter((event) => needsGrades(event, now));
  if (!admin) {
    const toLaunch = attentionAll.filter((event) => !fullyLaunched(summaryOf(event.id))).length;
    const toPublish = attentionAll.length - toLaunch;
    const attentionCount = attentionAll.length + (pendingTotal ? 1 : 0);
    const hintParts = [
      toLaunch ? `${toLaunch} para lançar` : null,
      toPublish ? `${toPublish} para publicar` : null,
      // os pedidos contam como 1 linha da seção (a quantidade fica no indicador "Pedidos de entrada")
      pendingTotal ? "pedidos de entrada na turma" : null,
    ].filter(Boolean) as string[];
    kpis.push({
      id: "atencao",
      label: "Precisa de atenção",
      icon: attentionCount ? AlertTriangle : CheckCircle2,
      value: attentionCount,
      hint: attentionCount ? joinList(hintParts) : "Tudo em dia",
      tone: attentionCount ? "attn" : "ok",
      ic: attentionCount ? "k-ipe" : "k-ok",
      aria: attentionCount ? `Precisa de atenção: ${attentionCount}, ${joinList(hintParts)}` : "Precisa de atenção: nada, tudo em dia",
      go: { period: "overview" },
    });
    const soonEvals = manageableEvents
      .filter((event) => isGradable(event) && isOpen(event) && tabOf(event, now) === "upcoming" && startTime(event) <= soonLimit)
      .sort((a, b) => startTime(a) - startTime(b));
    const dates = soonEvals.slice(0, 2).map((event) => `${weekdayLabels[new Date(event.startsAt).getDay()]} ${dayMonth(event.startsAt)}`);
    kpis.push({
      id: "proximas",
      label: "Próximas avaliações",
      icon: CalendarDays,
      ic: "k-prova",
      value: soonEvals.length,
      hint: soonEvals.length
        ? `${joinList(dates)}${soonEvals.length > 2 ? ` e mais ${soonEvals.length - 2}` : ""}`
        : `Nenhuma nos próximos ${SOON_DAYS} dias`,
      aria: `Próximas avaliações nos próximos ${SOON_DAYS} dias: ${soonEvals.length}`,
      go: { period: "upcoming" },
    });
    const pastEvals = manageableEvents.filter(
      (event) => isGradable(event) && event.status !== "cancelled" && tabOf(event, now) === "past"
    );
    const published = pastEvals.filter((event) => event.gradesPublishedAt).length;
    kpis.push({
      id: "publicadas",
      label: "Notas publicadas",
      icon: ClipboardCheck,
      ic: "k-ok",
      value: (
        <>
          {published}
          <small>
            {`de ${pastEvals.length}`}
            <span className="gx-kpi-noun">{pastEvals.length === 1 ? " avaliação" : " avaliações"}</span>
          </small>
        </>
      ),
      bar: pastEvals.length ? published / pastEvals.length : 0,
      hint: pastEvals.length ? undefined : "Nenhuma avaliação passou ainda",
      aria: `Notas publicadas: ${published} de ${countText(pastEvals.length, "avaliação", "avaliações")}`,
      go: { period: "past" },
    });
    const classTotal = classesSummary?.classes ?? classCount(assignments);
    // sem pedidos, o 4º indicador é "Alunos ativos" (a soma das turmas, contrato 8 com my-classes.tsx); com pedidos,
    // "Pedidos de entrada". Os dois vêm do resumo da lista de turmas: enquanto ela carrega, o card inteiro (rótulo
    // inclusive) é esqueleto, sem limite de tempo, porque ainda não se sabe qual dos dois ele vai ser. Só se a lista
    // der erro ele mostra na hora as turmas, que já se sabe pelo contexto
    const activeStudents = classesSummary?.activeStudents;
    const classesLoading = teacherTabs && !classesSummary && !classesError;
    kpis.push(
      classesLoading
        ? {
            id: "alunos",
            label: "",
            icon: Users,
            value: <span className="skel gx-kpi-skel" aria-hidden />,
            hint: <span className="skel gx-kpi-skel-hint" aria-hidden />,
            loading: true,
            aria: "Minhas turmas: carregando",
            go: "classes",
          }
        : pendingTotal
          ? {
              id: "pedidos",
              label: "Pedidos de entrada",
              icon: UserPlus,
              ic: "k-ipe",
              value: pendingTotal,
              hint: "Esperando sua decisão em Minhas turmas",
              tone: "attn",
              aria: `Pedidos de entrada: ${pendingTotal}`,
              go: "classes",
            }
          : activeStudents !== undefined
          ? {
              id: "alunos",
              label: "Alunos ativos",
              icon: Users,
              ic: "k-brand",
              value: activeStudents,
              hint: "Nenhum pedido de entrada",
              aria: `Alunos ativos: ${activeStudents}, em ${countText(classTotal, "turma", "turmas")}, nenhum pedido de entrada`,
              go: "classes",
            }
          : {
              id: "turmas",
              label: "Minhas turmas",
              icon: Users,
              ic: "k-brand",
              value: classTotal,
              hint: "Nenhum pedido de entrada",
              aria: `Minhas turmas: ${classTotal}, nenhum pedido de entrada`,
              go: "classes",
            }
    );
  } else {
    const upcomingAll = manageableEvents.filter((event) => tabOf(event, now) === "upcoming");
    const next30 = upcomingAll.filter((event) => startTime(event) <= soonLimit);
    const changedAhead = upcomingAll.filter(isChanged).length;
    // "Eventos das turmas" igual ao do Painel (decisão 7): o número grande são os eventos de turma à frente, abertos
    // (openAhead, a mesma conta do Painel), e a dica é o total
    const openAheadAll = openAhead(manageableEvents, now);
    // (a mesma regra do subtítulo, do filtro Origem e de "Próximos 30 dias": tudo o que não é data da instituição)
    const classEventsAhead = openAheadAll.filter((event) => !isOfficialDate(event)).length;
    const classEventsTotal = manageableEvents.filter((event) => !isOfficialDate(event)).length;
    // "Datas da instituição" com o mesmo valor e a mesma dica do Painel: as datas à frente e até quando vão
    // ("até janeiro de 2028"), curta e sem repetir o número
    const officialDates = upcomingOfficialDates(manageableEvents, now);
    const officialOpenAhead = officialDates.length;
    const lastOfficial = officialDates[officialDates.length - 1];
    const officialRange = lastOfficial
      ? `até ${new Date(lastOfficial.startsAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`
      : "nenhuma à frente";
    kpis.push(
      {
        id: "30dias",
        label: `Próximos ${SOON_DAYS} dias`,
        icon: CalendarClock,
        ic: "k-brand",
        value: next30.length,
        hint: next30.length
          ? `${next30.filter(isOfficialDate).length} da instituição e ${next30.filter((event) => !isOfficialDate(event)).length} das turmas`
          : "Nada marcado nesse prazo",
        aria: `Próximos ${SOON_DAYS} dias: ${eventsText(next30.length)}`,
        go: { period: "upcoming" },
      },
      {
        id: "instituicao",
        label: "Datas da instituição",
        icon: ShieldCheck,
        ic: "k-azul",
        value: officialOpenAhead,
        hint: officialRange,
        aria: `Datas da instituição: ${officialOpenAhead} à frente, ${officialRange}`,
        go: { period: "upcoming", origin: "official" },
      },
      {
        id: "turmas",
        label: "Eventos das turmas",
        icon: Target,
        ic: "k-trab",
        value: classEventsAhead,
        hint: `${classEventsTotal} no total`,
        aria: `Eventos das turmas: ${classEventsAhead} à frente, ${classEventsTotal} no total`,
        go: { period: "upcoming", origin: "classes" },
      },
      {
        id: "alterados",
        label: "Alterados ou cancelados",
        icon: RefreshCw,
        value: changedAhead,
        hint: changedAhead ? "Entre os próximos" : "Nenhum entre os próximos",
        tone: changedAhead ? "attn" : undefined,
        ic: changedAhead ? "k-ipe" : "k-prova",
        aria: `Alterados ou cancelados entre os próximos: ${changedAhead}`,
        go: { period: "upcoming", changed: true },
      }
    );
  }

  function summaryOf(id: number) {
    const value = summaries.get(id);
    return value && value !== "error" ? value : null;
  }

  const kpiRow = (
    <div className="kpis gx-kpis">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon;
        return (
          <div
            key={kpi.id}
            className={cx(
              "card kpi is-link rise",
              kpi.tone === "attn" && "attn",
              kpi.tone === "ok" && "gx-ok",
              kpi.loading && "gx-kpi-loading"
            )}
            style={delay(index)}
            aria-busy={kpi.loading || undefined}
          >
            {/* rodada 10: o ícone num quadrado suave colorido, antes do rótulo (.kpi-ic do dono base) */}
            <div className="kpi-top">
              <span className={cx("kpi-ic", kpi.loading ? "skel" : (kpi.ic ?? "k-brand"))} aria-hidden>
                {kpi.loading ? null : <Icon />}
              </span>
              <button
                className="kpi-hit kpi-label"
                aria-label={kpi.aria}
                onClick={() => (kpi.go === "classes" ? openClasses() : applyKpi(kpi.go))}
                type="button"
              >
                {kpi.loading ? <span className="skel gx-kpi-skel-label" aria-hidden /> : kpi.label}
              </button>
            </div>
            <p className="kpi-val" aria-hidden>
              {kpi.value}
            </p>
            {kpi.bar !== undefined ? (
              <span className="gx-bar green" aria-hidden>
                <i style={{ width: `${Math.round(kpi.bar * 100)}%` }} />
              </span>
            ) : null}
            {kpi.hint ? (
              <p className="kpi-hint" aria-hidden>
                {kpi.hint}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const periods: Period[] = admin ? ["upcoming", "past", "all"] : ["overview", "upcoming", "past", "all"];
  const periodCount = (item: Period) => (item === "overview" ? null : counts[item]);
  const originOptions: SelectOption<Origin>[] = (["all", "official", "classes"] as const).map((value) => ({
    value,
    label: originLabels[value],
    count: originCounts[value],
  }));
  const filters = (
    <div className="gx-fbar">
      <div
        ref={segRef}
        className={cx("seg gx-seg", periods.length > 3 && "gx-seg-4")}
        role="group"
        aria-label="Período"
      >
        {periods.map((item) => {
          const on = shownPeriod === item;
          const n = periodCount(item);
          return (
            <button
              key={item}
              className={cx(on && "on")}
              data-period={item}
              aria-pressed={on}
              onClick={() => choosePeriod(item)}
              type="button"
            >
              {periodLabels[item]}
              {n === null ? null : <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="gx-fright">
        {onlyChanged ? (
          <button className="chip on gx-chip" onClick={() => setOnlyChanged(false)} type="button" aria-label="Tirar o filtro: só alterados ou cancelados">
            Só alterados ou cancelados
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        {admin ? (
          <Select<Origin>
            variant="filter"
            prefix="Origem:"
            ariaLabel="Origem"
            active={origin !== "all"}
            value={origin}
            options={originOptions.map((option) => (option.value === "all" ? { ...option, label: "Todas" } : option))}
            onChange={(value) => chooseOrigin(value)}
          />
        ) : subjectOptions.length ? (
          <Select
            variant="filter"
            prefix="Disciplina:"
            ariaLabel="Disciplina"
            active={subjectFilter !== "all"}
            value={subjectFilter}
            options={subjectOptions}
            onChange={(value) => {
              pendingRef.current = null;
              setSubject(value);
            }}
          />
        ) : null}
      </div>
      {/* administração (sem abas): "Importar calendário" e "Novo evento oficial" na barra de controles, à direita */}
      {!teacherTabs && headerActions ? <div className="gx-fact">{headerActions}</div> : null}
    </div>
  );

  // a busca é a do menu: a lista avisa que está filtrada, quantos achou e quantos o filtro de origem esconde
  const searchNote = term && rows.length ? (
    <div className="gestao-searchnote" role="status">
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">
        Busca: <b>{searchShown}</b>, {eventsText(rows.length)} em {activeLabel}
        {hiddenByOrigin ? `, ${hiddenByOrigin} ${hiddenByOrigin === 1 ? "escondido" : "escondidos"} pelo filtro de origem` : ""}
      </span>
      <span className="gestao-searchnote-acts">
        {hiddenByOrigin ? (
          <button className="btn btn-g btn-sm shrink-0" onClick={showAllOrigins} type="button">
            Ver todas as origens
          </button>
        ) : null}
        {onClearSearch ? (
          <button className="btn btn-g btn-sm shrink-0" onClick={clearSearch} type="button">
            <X className="h-4 w-4" aria-hidden />
            Limpar busca
          </button>
        ) : null}
      </span>
    </div>
  ) : null;

  const emptyFiltered = (
    <div className="empty-inline gx-empty">
      <span className="empty-ico">
        <SearchX className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold text-ink wrap-anywhere">
        {hiddenByOrigin
          ? `Nenhum em ${originLabels[origin]} para “${searchShown}”`
          : term && !counts.all
            ? `Nada encontrado para “${searchShown}”`
            : term
              ? `Nada em ${activeLabel} para “${searchShown}”`
              : `Nenhum evento em ${activeLabel}${originNote ? `, ${originNote}` : ""}${onlyChanged ? ", só alterados ou cancelados" : ""}`}
      </p>
      {hiddenByOrigin ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">
          {`${hiddenByOrigin} em outras origens${hiddenElsewhere ? `, ${hiddenElsewhere} em outros períodos` : ""}.`}
        </p>
      ) : otherTab ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">{`Há ${counts[otherTab]} em ${periodLabels[otherTab]}.`}</p>
      ) : term && !onClearSearch ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">Apague o texto da busca no menu para ver todos.</p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {otherTab ? (
          <button className="btn btn-s btn-sm" onClick={() => showPeriod(otherTab)} type="button">
            {`Ver em ${periodLabels[otherTab]}`}
          </button>
        ) : null}
        {origin !== "all" ? (
          <button className="btn btn-s btn-sm" onClick={showAllOrigins} type="button">
            Ver todas as origens
          </button>
        ) : null}
        {onlyChanged ? (
          <button className="btn btn-s btn-sm" onClick={() => setOnlyChanged(false)} type="button">
            Ver todos os eventos
          </button>
        ) : null}
        {term && onClearSearch ? (
          <button className="btn btn-s btn-sm" onClick={clearSearch} type="button">
            Limpar busca
          </button>
        ) : null}
      </div>
    </div>
  );

  /* ---------- visão geral (docente) ---------- */

  const sectionHead = (id: string, title: string, count: number, tone?: "amber", link?: ReactNode) => (
    <div className="gx-sech">
      <h3 id={id}>{title}</h3>
      <span className={cx("badge", tone)}>{count}</span>
      {link}
    </div>
  );

  const overviewCard = overview ? (
    <section className="card gx-card rise" style={delay(1)} aria-labelledby={listHeadingId}>
      <h3 id={listHeadingId} className="sr-only">
        Visão geral
      </h3>
      {/* a) o que pede ação: avaliações passadas sem notas publicadas e pedidos de entrada */}
      {overview.attention.length || pendingTotal ? (
        <div className="gx-sec attn" aria-labelledby={`${listHeadingId}-a`}>
          {sectionHead(`${listHeadingId}-a`, "Precisa de atenção", overview.attention.length + (pendingTotal ? 1 : 0), "amber")}
          <ul className="gx-list">
            {overview.attention.map((event) => eventRow(event, { attention: true, year: true }))}
            {pendingTotal ? (
              <li className="gx-row gx-req">
                <span className="gx-date gx-req-ico" aria-hidden>
                  <UserPlus className="h-5 w-5" />
                </span>
                <div className="gx-main">
                  <div className="gx-t">
                    <span className="gx-title">Pedidos de entrada na turma</span>
                  </div>
                  <div className="gx-m">
                    <span className="gx-aud">{`${countText(pendingTotal, "aluno esperando", "alunos esperando")} a sua aprovação`}</span>
                  </div>
                </div>
                <div className="gx-when" />
                <div className="gx-state" />
                <div className="gx-acts">
                  <button className="btn btn-p btn-sm gx-act" onClick={openClasses} type="button">
                    Ver pedidos
                  </button>
                </div>
                <div className="gx-more" />
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <div className="gx-sec ok">
          <p className="gx-allgood" role="status">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              <b>Tudo em dia.</b> As avaliações que já passaram têm notas publicadas.
            </span>
          </p>
        </div>
      )}
      {/* b) o que vem pela frente, por semana */}
      <div className="gx-sec" aria-labelledby={`${listHeadingId}-p`}>
        {sectionHead(
          `${listHeadingId}-p`,
          "Próximos",
          overview.upcomingTotal,
          undefined,
          overview.upcomingTotal > overview.upcoming.length ? (
            <button className="link gx-lnk" onClick={() => showPeriod("upcoming")} type="button">
              {`Ver os ${overview.upcomingTotal} próximos`}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          ) : null
        )}
        {overview.upcoming.length ? (
          groupByWeek(overview.upcoming, new Date(now)).map((group) => (
            <div key={group.label}>
              <p className="gx-sub">{group.label}</p>
              <ul className="gx-list">{group.items.map((event) => eventRow(event, { year: true }))}</ul>
            </div>
          ))
        ) : (
          <div className="gx-none">
            <p>Nenhum evento à frente.</p>
            {canCreate ? (
              <button className="btn btn-s btn-sm" onClick={onNewEvent} type="button">
                <Plus className="h-4 w-4" aria-hidden />
                Novo evento
              </button>
            ) : null}
          </div>
        )}
      </div>
      {/* c) o histórico recente, com a situação das notas */}
      {overview.past.length ? (
        <div className="gx-sec" aria-labelledby={`${listHeadingId}-r`}>
          {sectionHead(
            `${listHeadingId}-r`,
            "Passados recentemente",
            overview.past.length,
            undefined,
            overview.pastTotal > overview.past.length ? (
              <button className="link gx-lnk" onClick={() => showPeriod("past")} type="button">
                {`Ver os ${overview.pastTotal} passados`}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null
          )}
          <ul className="gx-list">{overview.past.map((event) => eventRow(event, { year: true }))}</ul>
        </div>
      ) : null}
    </section>
  ) : null;

  /* ---------- listas por período (Próximos, Passados, Todos) ---------- */

  const monthCounts = new Map([...months].map(([key, items]) => [key, items.length]));
  const monthMarks = new Set(
    [...months].filter(([, items]) => items.some((event) => isGradable(event))).map(([key]) => key)
  );
  const monthItems = byMonth ? (months.get(shownMonth) ?? []) : [];
  const anyState = visibleRows.some((event) => gradeState(event).kind !== "none");
  const backwards = listPeriod === "past";
  const goMonth = (key: number) => goToMonth(key);
  const goMonthFooter = (key: number) => goToMonth(key, true);
  const nextWith = monthKeys.find((key) => key > shownMonth) ?? null;
  const prevWith = [...monthKeys].reverse().find((key) => key < shownMonth) ?? null;
  const colHead = wide ? (
    <div className={cx("gx-colhead", !anyState && "no-state")} aria-hidden>
      <span>Evento</span>
      <span>Quando</span>
      {anyState ? <span>Notas</span> : null}
      <span className="r">Ações</span>
    </div>
  ) : null;

  const listCard = shownPeriod !== "overview" ? (
    <section className="card gx-card rise" style={delay(1)} aria-labelledby={listHeadingId}>
      {byMonth ? (
        <div ref={monthBarRef}>
          <h3 id={listHeadingId} className="sr-only">
            {`${activeLabel}, ${shownTitle}`}
          </h3>
          <MonthPicker
            card
            value={shownMonth}
            onChange={goMonth}
            counts={monthCounts}
            marks={monthMarks}
            min={minMonth}
            max={maxMonth}
            noun={EVENT_NOUN}
            titleRef={monthTitleRef}
          />
        </div>
      ) : (
        <div className="gx-sec gx-sec-top">
          <div className="gx-sech">
            <h3 id={listHeadingId}>{activeLabel}</h3>
            <span className="badge">{rows.length}</span>
          </div>
        </div>
      )}
      {searchNote ? <div className="gx-pad">{searchNote}</div> : null}
      {rows.length ? (
        byMonth ? (
          monthItems.length ? (
            <div key={`${shownPeriod}-${shownMonth}`} className={cx("gx-sec", !anyState && "no-state")}>
              {colHead}
              <ul className="gx-list" aria-label={`${activeLabel}, ${shownTitle}: ${eventsText(monthItems.length)}`}>
                {monthItems.map((event) => eventRow(event))}
              </ul>
            </div>
          ) : (
            <MonthEmpty
              title={`Nenhum evento em ${shownTitle.toLowerCase()}`}
              next={monthTarget(nextWith, monthCounts, goMonth, EVENT_NOUN)}
              prev={monthTarget(prevWith, monthCounts, goMonth, EVENT_NOUN)}
              endText={backwards ? undefined : `Não há eventos depois de ${shownTitle.toLowerCase()}`}
            />
          )
        ) : (
          <div className={cx("gx-sec", !anyState && "no-state")}>
            {colHead}
            {groups.map(([month, items]) => (
              <div key={month}>
                <p className="gx-sub">
                  {groupTitle(month)}
                  <span>{eventsText(items.length)}</span>
                </p>
                <ul className="gx-list" aria-label={`${activeLabel}, ${groupTitle(month)}: ${eventsText(items.length)}`}>
                  {items.map((event) => eventRow(event))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="gx-pad">{emptyFiltered}</div>
      )}
      {byMonth && rows.length ? (
        <MonthNeighbors
          main={backwards ? "prev" : "next"}
          prev={monthTarget(shownMonth > minMonth ? shownMonth - 1 : null, monthCounts, goMonthFooter, EVENT_NOUN)}
          next={monthTarget(shownMonth < maxMonth ? shownMonth + 1 : null, monthCounts, goMonthFooter, EVENT_NOUN)}
        />
      ) : null}
    </section>
  ) : null;

  const eventsContent = manageableEvents.length ? (
    <div className="gx-stack">
      {kpiRow}
      {filters}
      <div ref={listRef} className="gx-listwrap">
        {overviewCard}
        {listCard}
      </div>
    </div>
  ) : (
    <section className="card pad rise">
      <div className="empty-inline gx-empty">
        <span className="empty-ico">
          <CalendarPlus className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-2 text-[15px] font-bold text-ink">Nenhum evento criado ainda</p>
        <p className="max-w-sm text-[13px] leading-5 text-muted">
          {admin
            ? "Publique o primeiro evento oficial para toda a instituição."
            : "Publique a primeira prova ou trabalho para a turma."}
        </p>
        {canCreate ? (
          <button className="btn btn-p mt-3" onClick={onNewEvent} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            {newLabel}
          </button>
        ) : null}
      </div>
    </section>
  );

  const classTotal = classesSummary?.classes ?? classCount(assignments);
  const paneTabs = [
    {
      id: "events" as const,
      label: "Eventos",
      count: manageableEvents.length,
      aria: `Eventos, ${eventsText(manageableEvents.length)}`,
    },
    {
      id: "classes" as const,
      label: "Minhas turmas",
      count: classTotal,
      aria: `Minhas turmas, ${countText(classTotal, "turma", "turmas")}${
        pendingTotal ? `, ${countText(pendingTotal, "pedido de entrada", "pedidos de entrada")}` : ""
      }`,
    },
  ];

  return (
    <div className="manage-view gx">
      {header}
      {teacherTabs ? (
        <>
          {/* rodada 10: a tela começa pelas abas, com "Novo evento" (o dividido) na mesma linha, à direita */}
          <div className="gx-top">
          <div ref={paneTabsRef} className="tabs gx-tabs" role="tablist" aria-label="Gestão">
            {paneTabs.map((item) => {
              const selected = pane === item.id;
              return (
                <button
                  key={item.id}
                  id={`${paneIds[item.id]}-aba`}
                  className={cx("tab", selected && "on")}
                  data-pane={item.id}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={paneIds[item.id]}
                  aria-label={item.aria}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => choosePane(item.id)}
                  onKeyDown={paneKeyDown}
                  type="button"
                >
                  {item.label}
                  <span className="n">{item.count}</span>
                  {item.id === "classes" && pendingTotal ? (
                    <span className="badge amber">{countText(pendingTotal, "pedido", "pedidos")}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {headerActions ? <div className="gx-top-a">{headerActions}</div> : null}
          </div>
          <div id={paneIds.events} role="tabpanel" aria-labelledby={`${paneIds.events}-aba`} hidden={pane !== "events"}>
            {noAssignments ? (
              <section className="card pad rise gx-notice">
                <NoAssignmentsNotice heading="h2" />
              </section>
            ) : null}
            {eventsContent}
          </div>
          <div id={paneIds.classes} role="tabpanel" aria-labelledby={`${paneIds.classes}-aba`} hidden={pane !== "classes"}>
            <MyClasses
              context={context}
              search={menuSearch}
              onSearchCount={setClassesSearchCount}
              onSummary={setClassesSummary}
              onLoadError={setClassesError}
            />
          </div>
        </>
      ) : (
        <>
          {/* administração: as ações ficam na linha dos filtros; sem nenhum evento (sem filtros), numa linha própria */}
          {headerActions && !manageableEvents.length ? (
            <div className="gx-top gx-top-solo">
              <div className="gx-top-a">{headerActions}</div>
            </div>
          ) : null}
          {eventsContent}
        </>
      )}
    </div>
  );
}
