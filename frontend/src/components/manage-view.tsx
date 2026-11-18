"use client";

import {
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  NBSP,
  countText,
  cx,
  dateParts,
  isSameDay,
  matchesSearch,
  monthGroupLabel,
  startOfDay,
} from "@/lib/format";
import { categoryMeta, isGradable, showsOfficialPill, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, TeachingAssignment, UserRole } from "@/lib/types";
import { delay, isOfficialDate, upcomingOfficialDates } from "./dashboard-bits";
import { eventLastDay, formatDayRange, reactivatedStatus } from "./event-bits";
import {
  NoAssignmentsNotice,
  activeAssignments,
  eventWhen,
  eventWhenLabel,
  type EventStatusChange,
} from "./event-editor";
import { RowMenu, type RowMenuItem } from "./gestao-row-menu";
import { MonthBar, MonthPagerFooter, MonthStrip, type MonthChip, type PagerTarget } from "./month-pager";
import { MyClasses, type MyClassesSummary } from "./my-classes";

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
/* Abas, busca e ordem                                                 */
/* ------------------------------------------------------------------ */

/**
 * Abas de tempo, as mesmas do Cronograma e com a mesma regra: passado é o evento cujo último dia já passou
 * (o de hoje ainda está em Próximos). A situação (Concluído, Cancelado, Alterado) fica na etiqueta da linha.
 */
type StatusTab = "upcoming" | "past" | "all";

/** Ações do menu "Mais ações" da linha. */
type RowAction = "grades" | "status" | "delete";

const tabs: Array<{ id: StatusTab; label: string }> = [
  { id: "upcoming", label: "Próximos" },
  { id: "past", label: "Passados" },
  { id: "all", label: "Todos" },
];

/** De onde vem o evento (só a administração escolhe): as datas oficiais da instituição ou os eventos das turmas. */
type Origin = "all" | "official" | "classes";

// os mesmos nomes nas abas do computador e na lista de escolha do celular
const origins: Array<{ id: Origin; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "official", label: "Da instituição" },
  { id: "classes", label: "Das turmas" },
];

function matchesOrigin(event: AcademicEvent, origin: Origin) {
  return origin === "all" || (origin === "official") === isOfficialDate(event);
}

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
// abas em botões a partir de 768px (elas cabem, quebrando a linha entre o período e a origem); no celular, listas de escolha
const tabsMedia = mediaStore("(min-width: 768px)");
// tabela de cinco colunas (Figma) a partir de 1280px. Turma, Data, Situação e Ações têm largura fixa
// (600px) e o título fica com o resto, inteiro nos títulos comuns. Abaixo disso a coluna do evento
// ficaria estreita demais, e entram os cartões, que mostram o título inteiro.
const tableMedia = mediaStore("(min-width: 1280px)");
// o card ao lado só fica ao lado da lista a partir de 1600px (a tabela fica com 916px); abaixo disso
// ele desce para depois da lista e a tabela usa a largura toda, como no Figma (1116px a 1440px).
// O card das datas oficiais (administração) só existe lado a lado: embaixo da lista ele só repetia as
// primeiras linhas dela, e o filtro "Origem" faz o atalho dele em qualquer largura
const sideMedia = mediaStore("(min-width: 1600px)");
const SIDE_COLUMNS = "min-[1600px]:grid-cols-[minmax(0,1fr)_var(--side-w)]";
// respiro do card parado no alto, em cima e embaixo (o mesmo do menu)
const SIDE_ROOM = 20;
// com aviso no canto, o card parado sobe no máximo isso acima do alto da tela (o -16px do .manage-side
// no globals.css): sai só parte do respiro de cima, e o título continua à vista
const SIDE_LIFT = 16;
// card das datas oficiais ao lado da lista: até 5 datas, menos quando a lista do mês é curta, para os dois
// cards terminarem juntos (a sobra que fica, no máximo SIDE_FIT, vai para cima do pé do mês da lista)
const SIDE_DATES = 5;
const SIDE_FIT = 40;

/**
 * O card ao lado só fica parado no alto quando cabe inteiro na tela, com o respiro em cima e embaixo
 * (o título à vista). Com aviso embaixo (room: a altura que os avisos tomam, com a folga; ver toastRoom),
 * ele também precisa caber entre SIDE_LIFT acima do alto da tela e o aviso. Se não cabe, ele rola com a
 * página, como o card de baixo, e nada clicável fica preso embaixo do aviso.
 */
function sideSticks(cardHeight: number, viewportHeight: number, room = 0) {
  if (cardHeight <= 0 || cardHeight + 2 * SIDE_ROOM > viewportHeight) {
    return false;
  }
  return cardHeight + Math.max(SIDE_ROOM, room) - SIDE_LIFT <= viewportHeight;
}

/**
 * Altura que os avisos tomam embaixo, das medidas que o ui.tsx põe no :root enquanto eles estão na tela:
 * o canto ocupado por eles (--toast-corner) e o pé que eles abrem no fim da página (--toast-foot, que no
 * fim da lista empurra o card parado para cima). Vale a maior; sem aviso, 0.
 */
function toastRoom() {
  const style = document.documentElement.style;
  return Math.max(
    parseFloat(style.getPropertyValue("--toast-corner")) || 0,
    parseFloat(style.getPropertyValue("--toast-foot")) || 0
  );
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const startTime = (event: AcademicEvent) => new Date(event.startsAt).getTime();
const isOpen = (event: AcademicEvent) => event.status === "scheduled" || event.status === "changed";

/** Próximos ou Passados pela regra do Cronograma (inPeriod): o último dia do evento já passou? */
function tabOf(event: AcademicEvent, now: number): Exclude<StatusTab, "all"> {
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

function rowsFor(events: AcademicEvent[], tab: StatusTab, now: number) {
  const rows = tab === "all" ? [...events] : events.filter((event) => tabOf(event, now) === tab);
  // o que já passou aparece do mais recente para o mais antigo
  const newestFirst = tab === "past";
  return rows.sort((a, b) => (newestFirst ? startTime(b) - startTime(a) : startTime(a) - startTime(b)));
}

function countByTab(events: AcademicEvent[], now: number) {
  const counts: Record<StatusTab, number> = { upcoming: 0, past: 0, all: events.length };
  for (const event of events) {
    counts[tabOf(event, now)] += 1;
  }
  return counts;
}

function summaryLine(counts: Record<StatusTab, number>) {
  const parts = [
    counts.upcoming ? `${counts.upcoming} ${counts.upcoming === 1 ? "próximo" : "próximos"}` : null,
    counts.past ? `${counts.past} ${counts.past === 1 ? "passado" : "passados"}` : null,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) {
    return "Nenhum evento ainda.";
  }
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Meses: a lista mostra um mês por vez, como o Cronograma             */
/* ------------------------------------------------------------------ */

const shortMonths = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** ano * 12 + mês: os meses em ordem, para comparar e andar entre eles. */
function monthOfTime(time: number) {
  const date = new Date(time);
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Nome do mês nos grupos, no título do MonthPager, nos botões de mês e nos chips: "Novembro" no ano corrente e
 * "Janeiro de 2027" fora dele, como no Cronograma (decisão 2).
 */
function groupTitle(index: number) {
  return monthGroupLabel(new Date(Math.floor(index / 12), index % 12, 1));
}

/** Mês em que o evento entra na lista: o do início. Nos Próximos, o que está em andamento entra no mês de hoje. */
function monthOfEvent(event: AcademicEvent, tab: StatusTab, todayStart: number) {
  const start = startTime(event);
  return monthOfTime(tab === "upcoming" ? Math.max(start, todayStart) : start);
}

/** As linhas (já em ordem) separadas por mês. */
function groupByMonth(rows: AcademicEvent[], tab: StatusTab, todayStart: number) {
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
 * Mês que abre: nos Próximos, o primeiro (o de hoje, quando tem evento); em Passados, o mais recente; em
 * Todos, o de hoje ou o próximo com eventos (sem nenhum à frente, o último).
 */
function defaultMonth(keys: number[], tab: StatusTab, current: number) {
  if (!keys.length) {
    return null;
  }
  if (tab === "past") {
    return keys[keys.length - 1];
  }
  return keys.find((key) => key >= current) ?? keys[keys.length - 1];
}

/**
 * Mês escolhido que ficou sem evento (o único do mês foi excluído, concluído ou mudou de data): o vizinho
 * mais perto. Empate: o seguinte nos Próximos e em Todos; o anterior em Passados.
 */
function nearestMonth(keys: number[], target: number, backwards: boolean) {
  let best: number | null = null;
  for (const key of keys) {
    const distance = Math.abs(key - target);
    const bestDistance = best === null ? Infinity : Math.abs(best - target);
    if (distance < bestDistance || (distance === bestDistance && (backwards ? key < target : key > target))) {
      best = key;
    }
  }
  return best;
}

const eventsText = (count: number) => countText(count, "evento", "eventos");

/**
 * A partir de quantos eventos a lista passa a mostrar um mês por vez. Até isso, ela mostra tudo de uma vez,
 * com o nome do mês antes do primeiro evento de cada um (2 provas em 2 meses não pedem dois cliques).
 */
const MONTH_PAGING_FROM = 10;
const MONTH_PAGING_SEARCH_FROM = 20;

/**
 * Para quem é o evento, nos cartões do celular ("Matemática, TADS 5"). compact: sem a disciplina quando o
 * título já diz qual é ("Prova de Estrutura de Dados"), para a linha caber em duas linhas.
 */
function audienceOf(event: AcademicEvent, withTeacher: boolean, compact = false) {
  const subject = event.subject?.name;
  const inTitle = Boolean(subject) && compact && normalize(event.title).includes(normalize(subject ?? ""));
  return [
    inTitle ? null : subject,
    event.academicClass?.name ?? "Toda a instituição",
    withTeacher && event.source === "teacher" ? event.teacher?.fullName : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Linha de baixo do cartão: quando e para quem ("18:00, Matemática, TADS 5"). Quebra a linha inteira, sem
 * reticências; os pedaços curtos ("TADS 5", "Dia todo") não se partem no meio (espaço não separável).
 */
function rowMeta(event: AcademicEvent, withTeacher: boolean) {
  const parts = [sideWhen(event), ...audienceOf(event, withTeacher, true).split(", ")];
  return parts.map((part) => (part.length <= 10 ? part.replace(/ /g, NBSP) : part)).join(", ");
}

/** Turno com inicial maiúscula, como no Painel da docente: "Noturno". */
function shiftLabel(shift?: string | null) {
  return shift ? shift.charAt(0).toUpperCase() + shift.slice(1) : null;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Data da linha em duas linhas curtas que cabem na coluna: "qui, 05/11" e "19:00 até 21:00" (ou "08:00 até 21/11").
 * Todas as listas da Gestão (tabela, cartões e o card das datas oficiais) são agrupadas por mês, e o cabeçalho do
 * mês já diz o ano fora do ano corrente ("Março de 2027"): a linha não repete o ano ("seg, 01/03", "01 a 30/09").
 * Só o período que vira o ano leva o ano do fim ("28/12 a 05/01/2027"), que não está no cabeçalho.
 */
function rowWhen(event: AcademicEvent) {
  const when = eventWhen(event.startsAt, event.endsAt);
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (when.time === "Dia todo" && when.day.includes(" a ")) {
    // período de dias inteiros no mesmo formato das listas do Painel e do Cronograma: "11 a 15/01", "30/11 a 02/12"
    const last = eventLastDay(event);
    const crossesYear = last.getFullYear() !== start.getFullYear();
    return { day: `${formatDayRange(event)}${crossesYear ? `/${last.getFullYear()}` : ""}`, time: when.time };
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

/**
 * Quando, numa linha só, nos cartões e no card das datas oficiais: o dia do início já está no bloco da data.
 * "19:00 até 21:00", "08:00 até 05/11", "Dia todo" ou "17/11 a 19/11, dia todo".
 */
function sideWhen(event: AcademicEvent) {
  const when = rowWhen(event);
  return when.time === "Dia todo" && when.day.includes(" a ") ? `${when.day}, dia todo` : when.time;
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

/** Fundo verde que some em 3 s na linha salva. */
function flashRow(row: HTMLElement) {
  const from = getComputedStyle(document.documentElement).getPropertyValue("--brand-100").trim() || "#d3eddb";
  const to = getComputedStyle(row).backgroundColor;
  row.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 3000, easing: "ease-out" });
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
  /** Mantido por compatibilidade: o card das datas oficiais usa a lista da Gestão, a mesma do filtro. */
  allEvents?: AcademicEvent[];
  editingEventId: number | null;
  lastSavedId?: number | null;
  savedTick?: number;
  saving?: boolean;
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onEdit: (event: AcademicEvent) => void;
  onDelete: (event: AcademicEvent) => void;
  onSetStatus?: (event: AcademicEvent, status: EventStatusChange) => void;
  /**
   * Abre a gaveta de notas da avaliação (EventGradesDrawer), pela ação "Notas" na linha do evento avaliativo
   * (prova ou trabalho de turma; isGradable de lib/meta). A página cuida da gaveta.
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
   * Eventos, os eventos da origem escolhida em todas as abas de tempo (o "Todos"); em Minhas turmas, as turmas.
   * null sem busca (ou enquanto a lista de turmas carrega).
   */
  onSearchCount?: (count: number | null) => void;
};

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
  onSetStatus,
  onOpenGrades,
  search: menuSearch = "",
  onClearSearch,
  onPaneChange,
  onSearchCount,
}: ManageViewProps) {
  const admin = isAdmin || role === "admin";
  const wide = useSyncExternalStore(tabsMedia.subscribe, tabsMedia.read, onServer);
  const tableWide = useSyncExternalStore(tableMedia.subscribe, tableMedia.read, onServer);
  const sideWide = useSyncExternalStore(sideMedia.subscribe, sideMedia.read, onServer);
  const headingId = useId();
  const originLabelId = useId();
  const paneIds = { events: useId(), classes: useId() };
  // a docente tem as abas Eventos e Minhas turmas; a administração continua só com os eventos (ela tem a tela Turmas)
  const teacherTabs = !admin && role === "teacher";
  const [pane, setPane] = useState<ManagePane>(() => (teacherTabs ? readPane() : "events"));
  const [classesSummary, setClassesSummary] = useState<MyClassesSummary | null>(null);
  const paneTabsRef = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<StatusTab>("upcoming");
  // origem (administração): todas, só as datas oficiais da instituição ou só os eventos das turmas
  const [origin, setOrigin] = useState<Origin>("all");
  // mês escolhido, valendo para o filtro em que foi escolhido (aba, origem e busca); trocou o filtro, volta ao padrão
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
  // card ao lado: a altura dele vai para --side-h (o sticky do globals.css, .manage-side, usa)
  const [sideNode, setSideNode] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listCardRef = useRef<HTMLElement>(null);
  // quantas datas o card ao lado mostra; sideFor: a altura da lista para a qual esse número foi medido
  const [sideLimit, setSideLimit] = useState(SIDE_DATES);
  const sideFor = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabSelectRef = useRef<HTMLSelectElement>(null);
  const monthBarRef = useRef<HTMLDivElement>(null);
  const monthTitleRef = useRef<HTMLHeadingElement>(null);
  // trocou de mês pelo pé da lista (conta as trocas): o cabeçalho do mês volta para a vista e recebe o foco
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
  // "Novo evento de ..." só nas ofertas que aceitam evento novo (sem disciplina arquivada), como o seletor do painel
  const publishable = activeAssignments(context);
  // a busca do menu vale para os eventos só com a aba Eventos aberta (em Minhas turmas, ela procura turmas)
  const searchShown = pane === "events" ? menuSearch.trim() : "";
  const term = normalize(searchShown);
  const todayStart = startOfDay(new Date(now)).getTime();
  const currentMonth = monthOfTime(now);
  const filterKey = (forTab: StatusTab, forOrigin: Origin, forTerm: string) => `${forTab}|${forOrigin}|${forTerm}`;
  const filtered = (searchTerm: string, forOrigin: Origin) =>
    manageableEvents.filter(
      (event) => matchesOrigin(event, forOrigin) && matchesTerm(event, searchTerm)
    );

  // salvou (p2 avisa por savedTick): mostrar a linha salva, trocando de aba, de origem e de mês se preciso
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
      const targetTab = tab === "all" || tabOf(target, now) === tab ? tab : tabOf(target, now);
      if (!keepOrigin) {
        setOrigin("all");
      }
      if (targetTab !== tab) {
        setTab(targetTab);
      }
      setPicked({
        key: filterKey(targetTab, keepOrigin ? origin : "all", clearSearch ? "" : term),
        index: monthOfEvent(target, targetTab, todayStart),
      });
      setReveal({ ...reveal, ready: true, clearSearch });
    }
  }

  const searched = filtered(term, origin);
  const counts = countByTab(searched, now);
  const overall = countByTab(manageableEvents, now);
  const rows = rowsFor(searched, tab, now);
  const months = groupByMonth(rows, tab, todayStart);
  const monthKeys = [...months.keys()].sort((a, b) => a - b);
  const currentKey = filterKey(tab, origin, term);
  // o mês escolhido ficou vazio (o único evento dele saiu da lista): fica o vizinho, não o mês padrão
  const shownMonth =
    picked && picked.key === currentKey && monthKeys.length
      ? months.has(picked.index)
        ? picked.index
        : nearestMonth(monthKeys, picked.index, tab === "past")
      : defaultMonth(monthKeys, tab, currentMonth);
  // lista curta: tudo de uma vez, separado por mês; longa: um mês por vez. A busca já estreita a lista,
  // então com ela o limite é maior (os 12 recessos aparecem juntos, cada um com o mês)
  const byMonth = rows.length > (term ? MONTH_PAGING_SEARCH_FROM : MONTH_PAGING_FROM) && shownMonth !== null;
  const groups: Array<[number, AcademicEvent[]]> = byMonth ? [[shownMonth, months.get(shownMonth) ?? []]] : [...months];
  const visibleRows = groups.flatMap(([, items]) => items);
  const rowIndex = new Map(visibleRows.map((event, index) => [event.id, index]));
  const monthPosition = byMonth ? monthKeys.indexOf(shownMonth) : -1;
  const prevMonth = monthPosition > 0 ? monthKeys[monthPosition - 1] : null;
  const nextMonth = monthPosition >= 0 && monthPosition < monthKeys.length - 1 ? monthKeys[monthPosition + 1] : null;
  const visibleKey = visibleRows.map((event) => event.id).join(",");
  // mês na tela (null: a lista toda, curta, de uma vez) e os meses do filtro, para o foco depois de uma ação
  const pagedMonth = byMonth ? shownMonth : null;
  const monthsKey = monthKeys.join(",");
  const canCreate = admin || context === null || assignments.length > 0;
  // origem (administração): quantos eventos cada uma tem dentro do período escolhido, com a busca (com
  // "Próximos 118": Todas 118, Da instituição 115, Das turmas 3; o número da aba bate com o tamanho da lista)
  const allOrigins = filtered(term, "all");
  const originCounts: Record<Origin, number> = {
    all: rowsFor(allOrigins, tab, now).length,
    official: rowsFor(filtered(term, "official"), tab, now).length,
    classes: rowsFor(filtered(term, "classes"), tab, now).length,
  };
  // a busca acha no período, mas o filtro de origem esconde (decisão 14: a tela diz quantos e oferece mostrar)
  const hiddenByOrigin = term && origin !== "all" ? originCounts.all - rows.length : 0;
  // fora do período escolhido (em qualquer origem): completa a conta do vazio com o total do menu
  const hiddenElsewhere = allOrigins.length - originCounts.all;
  const originLabel = origins.find((item) => item.id === origin)?.label ?? "";

  // contagem da busca do menu (contrato com a página): Eventos conta o que a busca acha na tela inteira, em todas
  // as origens e todos os períodos (o filtro de origem não muda o "N encontrados" do menu; a tela diz quantos ele
  // esconde); Minhas turmas repassa o que a MyClasses achou. Só a aba aberta conta (a MyClasses fica montada
  // escondida e também mede)
  const [classesSearchCount, setClassesSearchCount] = useState<number | undefined>(undefined);
  const searchCount = pane === "classes" ? (classesSearchCount ?? null) : searchShown ? allOrigins.length : null;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  // datas oficiais (administração), no card ao lado: as mesmas do Painel (upcomingOfficialDates: abertas, com
  // algum dia de hoje em diante, a em andamento inclusive). O atalho dele leva a lista para Próximos, só as
  // da instituição, e o N é o que a lista vai mostrar
  const showSideOfficial = admin && sideWide && pane === "events";
  const officialSoon = showSideOfficial ? upcomingOfficialDates(manageableEvents, now) : [];
  const officialListed = showSideOfficial ? rowsFor(filtered("", "official"), "upcoming", now).length : 0;

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
    // a própria ação pode trocar o mês na tela: o mês dela ficou vazio (vai para o vizinho) ou a lista ficou
    // curta e passou a mostrar tudo de uma vez
    const monthGone = pending.month !== null && !monthsKey.split(",").includes(String(pending.month));
    const sameView = pending.month === pagedMonth || monthGone || (pending.month !== null && pagedMonth === null);
    if (pending.filter !== currentKey || !sameView) {
      // a pessoa trocou de aba, de origem, de busca ou de mês: a linha não sumiu por causa da ação
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
        // mês vizinho: o primeiro dele (ou o último, quando o vizinho é o de antes)
        const backwards = monthGone && pagedMonth !== null && pending.month !== null && pagedMonth < pending.month;
        next = monthGone
          ? buttons[backwards ? buttons.length - 1 : 0]
          : buttons[Math.min(pending.index, buttons.length - 1)];
      }
      if (next) {
        next.focus();
      } else {
        (monthTitleRef.current ?? headingRef.current)?.focus();
      }
    });
  }, [visibleKey, reveal, currentKey, pagedMonth, monthsKey]);

  // mês novo pelo pé da lista: o cabeçalho do mês volta para a vista e o leitor de tela anuncia o mês
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

  // a barra do mês saiu pelo alto da tela: o nome do mês passa para o cabeçalho preso da tabela, para quem rola
  // um mês comprido saber em que mês está
  const [monthBarGone, setMonthBarGone] = useState(false);
  useEffect(() => {
    const bar = monthBarRef.current;
    if (!bar || !byMonth || !tableWide) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setMonthBarGone(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [byMonth, tableWide, shownMonth]);
  const monthInHead = byMonth && tableWide && monthBarGone;

  // o card ao lado fica parado no alto só quando cabe na tela (data-stick, que o sticky do globals.css,
  // .manage-side, usa); mais alto que a tela, ele rola com a página e o título não some. A altura dele
  // vai para --side-h: com aviso no canto, o card parado sobe para deixar o espaço do aviso. Quando nem
  // assim ele cabe, ele rola com a página enquanto houver aviso e volta a ficar parado quando o aviso sai
  useLayoutEffect(() => {
    if (!sideNode) {
      return;
    }
    const update = () => {
      const height = sideNode.offsetHeight;
      sideNode.style.setProperty("--side-h", `${height}px`);
      const stick = sideSticks(height, window.innerHeight, toastRoom());
      if (stick === sideNode.hasAttribute("data-stick")) {
        return;
      }
      // ao prender ou soltar, o card desliza de onde está até o lugar novo, sem pular
      const from = sideNode.getBoundingClientRect().top;
      sideNode.toggleAttribute("data-stick", stick);
      const shift = from - sideNode.getBoundingClientRect().top;
      if (Math.abs(shift) >= 1 && !reducedMotion()) {
        sideNode.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "ease",
        });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sideNode);
    // os avisos põem e tiram o --toast-corner e o --toast-foot no style do :root (ui.tsx)
    const toasts = new MutationObserver(update);
    toasts.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      toasts.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [sideNode]);

  // datas oficiais ao lado (a partir de 1600px): o card da lista estica até o fim da linha, com o pé do mês
  // embaixo, e o card ao lado mostra só as datas que cabem na altura da lista (no mínimo uma). Assim os dois
  // terminam juntos sem buraco: no máximo SIDE_FIT de sobra na lista. Com a lista mais alta (um mês cheio),
  // o card ao lado fica com as 5 e parado no alto enquanto ela rola
  useLayoutEffect(() => {
    const card = listCardRef.current;
    const list = listRef.current;
    if (!showSideOfficial || !sideNode || !card || !list) {
      return;
    }
    const fit = () => {
      // a lista sem a sobra do card esticado (a margem automática que empurra o pé do mês para baixo)
      const parts = [...list.children].reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
      const natural = card.offsetHeight - Math.max(0, list.offsetHeight - parts);
      const side = sideNode.offsetHeight;
      // a lista mudou de altura (outra busca, aba, mês ou largura): recomeça das SIDE_DATES e só tira, uma por
      // vez, até caber. Assim o número de datas depende só da lista de agora, não do caminho até ela
      if (sideFor.current !== null && Math.abs(sideFor.current - natural) > 2 && sideLimit < SIDE_DATES) {
        sideFor.current = natural;
        setSideLimit(SIDE_DATES);
        return;
      }
      sideFor.current = natural;
      if (side > natural + SIDE_FIT && sideLimit > 1) {
        setSideLimit(sideLimit - 1);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(sideNode);
    observer.observe(card);
    for (const child of [card.firstElementChild, ...list.children]) {
      if (child) {
        observer.observe(child);
      }
    }
    return () => observer.disconnect();
  }, [showSideOfficial, sideNode, sideLimit, visibleKey, tab, origin, term]);

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

  function chooseTab(next: StatusTab) {
    pendingRef.current = null;
    setTab(next);
  }

  function chooseOrigin(next: Origin) {
    pendingRef.current = null;
    setOrigin(next);
  }

  /** Mês escolhido na faixa, nas setas ou no pé da lista (fromFooter: o cabeçalho do mês volta para a vista). */
  function goToMonth(index: number, fromFooter = false) {
    setPicked({ key: currentKey, index });
    if (fromFooter) {
      setMonthJump((count) => count + 1);
    }
  }

  /** "Ver em ..." do aviso de lista vazia: o aviso some, e o foco vai para a aba escolhida. */
  function showTab(next: StatusTab) {
    chooseTab(next);
    const index = tabs.findIndex((item) => item.id === next);
    (tabsRef.current?.querySelectorAll<HTMLElement>("button")[index] ?? tabSelectRef.current)?.focus();
  }

  /**
   * "Limpar" do aviso da busca e "Limpar busca" da lista vazia: o botão some com a busca, então o foco vai
   * para o título da lista (sem rolar), e não para o body.
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

  /**
   * Guarda a linha da ação e as vizinhas dela na lista do filtro (de todos os meses): se a linha sumir, o foco
   * vai para a de baixo ou a de cima, mesmo que ela esteja no mês vizinho que a lista passou a mostrar.
   */
  function markPending(event: AcademicEvent, index: number) {
    const position = rows.findIndex((row) => row.id === event.id);
    pendingRef.current = {
      id: event.id,
      index,
      filter: currentKey,
      month: pagedMonth,
      before: position > 0 ? rows[position - 1].id : null,
      after: position >= 0 && position < rows.length - 1 ? rows[position + 1].id : null,
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

  /**
   * Atalho do card das datas oficiais: a lista passa para Próximos, só as da instituição, no primeiro mês
   * com data (a paginação por mês continua: nada de despejar as N de uma vez).
   */
  function showAllOfficial() {
    pendingRef.current = null;
    onClearSearch?.();
    setOrigin("official");
    setTab("upcoming");
    setPicked(null);
    headingRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
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

  const newLabel = admin ? "Novo evento oficial" : "Novo evento";
  const activeLabel = tabs.find((item) => item.id === tab)?.label ?? "";
  const otherTab = tabs.find((item) => item.id !== tab && item.id !== "all" && counts[item.id] > 0);
  const originNote = origin === "official" ? "só as datas da instituição" : origin === "classes" ? "só os das turmas" : null;
  const shownTitle = shownMonth === null ? "" : groupTitle(shownMonth);

  // "Mais ações" da linha: Notas (prova e trabalho de turma, quando não está à vista), Concluir ou Reativar, Excluir
  const moreItems = (event: AcademicEvent, withGrades: boolean) => {
    const items: RowMenuItem<RowAction>[] = [];
    if (withGrades && onOpenGrades && isGradable(event)) {
      items.push({ id: "grades", label: "Notas", icon: ClipboardCheck });
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
  };

  function runAction(event: AcademicEvent, index: number, action: RowAction) {
    if (action === "grades") {
      onOpenGrades?.(event.id);
    } else if (action === "status") {
      changeStatus(event, isOpen(event) ? "completed" : reactivatedStatus(event), index);
    } else {
      remove(event, index);
    }
  }

  // "Notas" na prova e no trabalho de turma, com texto (a ação que a docente mais usa): abre a gaveta de notas
  const gradesButton = (event: AcademicEvent) => {
    if (!onOpenGrades || !isGradable(event)) {
      return null;
    }
    return (
      <button
        className="btn btn-s btn-sm gestao-notas"
        aria-label={`Notas de ${event.title}`}
        aria-haspopup="dialog"
        onClick={() => onOpenGrades(event.id)}
        type="button"
      >
        <ClipboardCheck className="h-4 w-4" aria-hidden />
        Notas
      </button>
    );
  };
  // a coluna das ações ganha a largura do "Notas" quando alguma linha do mês tem notas; nas outras linhas,
  // um espaço do mesmo tamanho guarda o lugar, e o Editar e o "Mais ações" ficam alinhados em todas
  const gradesColumn = Boolean(onOpenGrades) && visibleRows.some(isGradable);
  const actionsColumn = gradesColumn ? "w-[206px] pointer-coarse:w-[218px]" : "w-[112px] pointer-coarse:w-[124px]";

  const savedPill = (
    <span className="pill stat bg-brand text-white">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Salvo agora
    </span>
  );
  const editingPill = (
    <span className="pill stat bg-brand-100 text-brand-ink">
      <Pencil className="h-3 w-3" aria-hidden />
      Em edição
    </span>
  );
  const officialPill = (
    <span className="pill prio shrink-0">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Oficial
    </span>
  );

  // situação na tabela: "Salvo agora" logo depois de salvar, "Em edição" com o painel aberto (que mostra a
  // situação no cabeçalho); no mais, a situação do evento, com a etiqueta neutra "Agendado" no futuro agendado
  // (a coluna nunca fica vazia) e "Já passou" no agendado ou alterado cuja data passou sem ser concluído
  const situationPill = (event: AcademicEvent) => {
    if (flash?.id === event.id) {
      return savedPill;
    }
    if (editingEventId === event.id) {
      return editingPill;
    }
    if (isOpen(event) && tabOf(event, now) === "past") {
      return <span className="pill stat">Já passou</span>;
    }
    return <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>;
  };

  // situação nos cartões: só o que foge do comum (o "Agendado" de quase todos não diz nada na linha curta)
  const cardSituation = (event: AcademicEvent) => {
    if (flash?.id === event.id) {
      return savedPill;
    }
    if (editingEventId === event.id) {
      return editingPill;
    }
    if (isOpen(event) && tabOf(event, now) === "past") {
      return <span className="pill stat">Já passou</span>;
    }
    if (event.status === "scheduled") {
      return null;
    }
    return <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>;
  };

  // segunda linha do evento na tabela (Figma: "Prova  10 pts"); na administração, quem publicou
  const rowDetail = (event: AcademicEvent) =>
    [
      admin && event.source === "teacher" ? event.teacher?.fullName : null,
      event.points !== null ? `${event.points.toLocaleString("pt-BR")} pts` : admin ? null : "sem pontuação",
    ]
      .filter(Boolean)
      .join(", ");

  // Figma (Gestão de eventos): Evento | Turma, disciplina | Data | Situação | Ações, rente às bordas do card.
  // Turma e Data têm duas linhas curtas (a Data cabe inteira: sem o ano, que está no cabeçalho do mês). O Evento
  // estica: título inteiro, como veio (a linha cresce), e a linha de baixo (categoria, quem publicou, pontos) quebra sem corte. A lista é de um mês só (o cabeçalho do mês diz qual, com o ano), e o cabeçalho
  // das colunas fica preso no alto da tela enquanto o mês rola (o card corta com overflow: clip, que não
  // segura o sticky; sem rolagem lateral: a tabela é table-fixed e cabe a partir de 1280px).
  const tableRow = (event: AcademicEvent, index: number) => {
    const meta = categoryMeta[event.category];
    const when = rowWhen(event);
    const editing = editingEventId === event.id;
    const cancelled = event.status === "cancelled";
    const closed = cancelled || event.status === "completed";
    const classLabel = event.academicClass?.name ?? "Toda a instituição";
    const subject = event.subject?.name;
    const detail = rowDetail(event);
    return (
      <tr
        key={event.id}
        data-event-id={event.id}
        data-editing={editing ? "" : undefined}
        aria-current={editing ? "true" : undefined}
        className={cx(
          "h-20 transition-colors hover:bg-surface-2",
          // concluído e cancelado ficam no fundo cinza, como no Figma
          closed && "bg-surface-2",
          editing && "!bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--brand)]"
        )}
      >
        <td>
          {/* título inteiro, como veio do PDF (decisão 12): a linha cresce nos títulos longos; h-20 é só o mínimo */}
          <p className={cx("t break-words leading-5", closed && "text-ink-3")}>
            {event.title}
          </p>
          {/* quem publicou e os pontos quebram a linha quando a coluna é estreita (1600px, com o card ao lado), sem corte */}
          <div className="s !mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cx("pill shrink-0", meta.tint)}>{meta.short}</span>
            {admin && showsOfficialPill(event) ? officialPill : null}
            {detail ? <span className="min-w-0 wrap-anywhere">{detail}</span> : null}
          </div>
        </td>
        {/* duas linhas curtas, como a Data: a turma em cima e a disciplina embaixo */}
        <td className={cx(closed && "text-muted")}>
          <p className="truncate" title={classLabel}>
            {classLabel}
          </p>
          {subject ? (
            <p className="s truncate" title={subject}>
              {subject}
            </p>
          ) : null}
        </td>
        <td className={cx(closed && "text-muted")}>
          <p className={cx("truncate font-semibold", cancelled && "line-through")}>{when.day}</p>
          <p className={cx("s truncate", cancelled && "line-through")}>{when.time}</p>
        </td>
        <td>
          <div className="flex">{situationPill(event)}</div>
        </td>
        <td>
          <div className="acts">
            {gradesColumn
              ? (gradesButton(event) ?? <span className="gestao-notas gestao-slot" aria-hidden />)
              : null}
            <button
              className="ib sm"
              data-edit-button=""
              aria-label={`Editar ${event.title}`}
              title="Editar"
              onClick={() => edit(event, index)}
              type="button"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <RowMenu
              label={`Mais ações de ${event.title}`}
              items={moreItems(event, false)}
              onSelect={(action) => runAction(event, index, action)}
            />
          </div>
        </td>
      </tr>
    );
  };

  const table = (
    <div className="border-t border-line">
      <table className="tbl gestao-tbl table-fixed [&_td]:px-3 [&_td]:py-[5px] [&_td:first-child]:pl-6 [&_td:last-child]:pl-1.5 [&_td:last-child]:pr-6 [&_th]:px-3 [&_th:first-child]:pl-6 [&_th:last-child]:pl-1.5 [&_th:last-child]:pr-6">
        <caption className="sr-only">{`${activeLabel}${byMonth ? `, ${shownTitle}` : ""}: ${eventsText(visibleRows.length)}`}</caption>
        <colgroup>
          <col />
          <col className="w-[184px]" />
          <col className="w-[128px]" />
          <col className="w-[132px]" />
          <col className={actionsColumn} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              Evento
              {monthInHead ? (
                <span className="gestao-th-month" aria-hidden>
                  {shownTitle}
                </span>
              ) : null}
            </th>
            <th scope="col">Turma, disciplina</th>
            <th scope="col">Data</th>
            <th scope="col">Situação</th>
            <th scope="col" className="text-right">
              Ações
            </th>
          </tr>
        </thead>
        {groups.map(([month, items]) => (
          <tbody key={month}>
            {byMonth ? null : (
              <tr className="gestao-month-row">
                <th colSpan={5} scope="rowgroup">
                  {groupTitle(month)}
                  <span className="n">{eventsText(items.length)}</span>
                </th>
              </tr>
            )}
            {items.map((event) => tableRow(event, rowIndex.get(event.id) ?? 0))}
          </tbody>
        ))}
      </table>
    </div>
  );

  // celular e tablet (abaixo de 1280px): uma linha curta por evento. A linha inteira abre o painel de edição;
  // os três pontos ao lado abrem Notas, Concluir e Excluir. O dia já está no bloco da data, e o mês e o ano
  // no cabeçalho do mês: a linha diz só a hora (ou o intervalo) e para quem é.
  const cardRow = (event: AcademicEvent, index: number) => {
    const meta = categoryMeta[event.category];
    const parts = dateParts(event.startsAt);
    const editing = editingEventId === event.id;
    const cancelled = event.status === "cancelled";
    const closed = cancelled || event.status === "completed";
    const situation = cardSituation(event);
    return (
      <li
        key={event.id}
        data-event-id={event.id}
        data-editing={editing ? "" : undefined}
        aria-current={editing ? "true" : undefined}
        className={cx("gestao-row", closed && "closed", editing && "editing")}
      >
        <button
          className="gestao-row-main"
          data-edit-button=""
          aria-label={`Editar ${event.title}, ${eventWhenLabel(event.startsAt, event.endsAt)}, ${audienceOf(event, admin)}`}
          onClick={() => edit(event, index)}
          type="button"
        >
          <span className="ev-date">
            <span className="dw">{parts.weekday}</span>
            <span className="dn">{parts.day}</span>
          </span>
          <span className="gestao-row-txt">
            <span className={cx("gestao-row-t", cancelled && "line-through")}>{event.title}</span>
            <span className="gestao-row-s">
              <span className={cx("pill shrink-0", meta.tint)}>{meta.short}</span>
              {admin && showsOfficialPill(event) ? officialPill : null}
              <span className="gestao-row-meta">{rowMeta(event, admin)}</span>
            </span>
            {situation ? <span className="gestao-row-pills">{situation}</span> : null}
          </span>
          {/* o lápis com o mesmo contorno do "Mais ações" ao lado (a linha inteira é o botão de editar) */}
          <span className="gestao-row-pen" aria-hidden>
            <Pencil className="h-4 w-4" />
          </span>
        </button>
        <RowMenu
          className="gestao-row-more"
          label={`Mais ações de ${event.title}`}
          items={moreItems(event, true)}
          onSelect={(action) => runAction(event, index, action)}
        />
      </li>
    );
  };

  const cards = (
    <div className="gestao-groups">
      {groups.map(([month, items]) => (
        <div key={month} className="gestao-group">
          {byMonth ? null : (
            <h3 className="gestao-group-h">
              {groupTitle(month)}
              <span className="n">{eventsText(items.length)}</span>
            </h3>
          )}
          <ul className="gestao-rows" aria-label={`${activeLabel}, ${groupTitle(month)}: ${eventsText(items.length)}`}>
            {items.map((event) => cardRow(event, rowIndex.get(event.id) ?? 0))}
          </ul>
        </div>
      ))}
    </div>
  );

  const emptyFiltered = (
    <div className="empty-inline !py-7">
      <span className="empty-ico">
        <SearchX className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold text-ink wrap-anywhere">
        {hiddenByOrigin
          ? `Nenhum em ${originLabel} para “${searchShown}”`
          : term && !counts.all
            ? `Nada encontrado para “${searchShown}”`
            : term
              ? `Nada em ${activeLabel} para “${searchShown}”`
              : `Nenhum evento em ${activeLabel}${originNote ? `, ${originNote}` : ""}`}
      </p>
      {hiddenByOrigin ? (
        // o total bate com o "N encontrados" do menu: o que a origem esconde aqui e o que está em outro período
        <p className="max-w-sm text-[13px] leading-5 text-muted">
          {`${hiddenByOrigin} em outras origens${hiddenElsewhere ? `, ${hiddenElsewhere} em outros períodos` : ""}.`}
        </p>
      ) : otherTab ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">
          {`Há ${counts[otherTab.id]} em ${otherTab.label}.`}
        </p>
      ) : term && !onClearSearch ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">Apague o texto da busca no menu para ver todos.</p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {otherTab ? (
          <button className="btn btn-s btn-sm" onClick={() => showTab(otherTab.id)} type="button">
            {`Ver em ${otherTab.label}`}
          </button>
        ) : null}
        {origin !== "all" ? (
          <button className="btn btn-s btn-sm" onClick={showAllOrigins} type="button">
            Ver todas as origens
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

  const newEventButton = canCreate ? (
    <button className="btn btn-p" onClick={onNewEvent} type="button">
      <Plus className="h-4 w-4" aria-hidden />
      {newLabel}
    </button>
  ) : null;

  // subtítulo: os números do momento. Com filtro de origem ou busca, quantos aparecem de quantos
  const subtitle =
    term || originNote
      ? `${searched.length} de ${eventsText(manageableEvents.length)}${originNote ? `, ${originNote}` : ""}`
      : summaryLine(overall);

  // filtros: o período (abas "Nome N": Próximos, Passados, Todos) e, na administração, a origem. Abaixo de 1100px, duas listas de escolha
  const filters = wide ? (
    <div className="gestao-filters">
      <div ref={tabsRef} className="seg gestao-seg" role="group" aria-label="Período">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={cx(tab === item.id && "on")}
            aria-pressed={tab === item.id}
            onClick={() => chooseTab(item.id)}
            type="button"
          >
            {item.label}
            <span className="n">{counts[item.id]}</span>
          </button>
        ))}
      </div>
      {admin ? (
        <div className="gestao-origin" role="group" aria-labelledby={originLabelId}>
          <span id={originLabelId} className="gestao-origin-l">
            Origem
          </span>
          <div className="seg gestao-seg">
            {origins.map((item) => (
              <button
                key={item.id}
                className={cx(origin === item.id && "on")}
                aria-pressed={origin === item.id}
                onClick={() => chooseOrigin(item.id)}
                type="button"
              >
                {item.label}
                <span className="n">{originCounts[item.id]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : (
    <div className={cx("gestao-selects", admin && "two")}>
      <label className="grid gap-2">
        <span className="lbl">Período</span>
        <select
          ref={tabSelectRef}
          className="input"
          value={tab}
          onChange={(event) => chooseTab(event.target.value as StatusTab)}
        >
          {tabs.map((item) => (
            <option key={item.id} value={item.id}>
              {`${item.label} ${counts[item.id]}`}
            </option>
          ))}
        </select>
      </label>
      {admin ? (
        <label className="grid gap-2">
          <span className="lbl">Origem</span>
          <select className="input" value={origin} onChange={(event) => chooseOrigin(event.target.value as Origin)}>
            {origins.map((item) => (
              <option key={item.id} value={item.id}>
                {`${item.label} ${originCounts[item.id]}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  // a busca é a do menu: a lista avisa que está filtrada, quantos achou e quantos o filtro de origem esconde
  // (decisão 14: "Busca: termo", a contagem, "N escondidos pelo filtro" com a ação de mostrar e "Limpar busca")
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

  // meses com eventos no filtro, como no Cronograma: "‹ Janeiro de 2027 ›" e a faixa "jan 2, fev 6..."
  const monthChips: MonthChip[] = monthKeys.map((key) => ({
    index: key,
    year: Math.floor(key / 12),
    short: shortMonths[key % 12],
    count: months.get(key)?.length ?? 0,
    label: `${groupTitle(key)}, ${eventsText(months.get(key)?.length ?? 0)}${key === currentMonth ? ", mês atual" : ""}`,
    dots: [],
    active: key === shownMonth,
    now: key === currentMonth,
  }));
  const pagerTarget = (index: number | null): PagerTarget | null =>
    index === null
      ? null
      : { title: groupTitle(index), count: eventsText(months.get(index)?.length ?? 0), onGo: () => goToMonth(index, true) };
  const monthNav =
    byMonth ? (
      <div className="crono-nav gestao-nav">
        <MonthBar
          barRef={monthBarRef}
          titleRef={monthTitleRef}
          title={shownTitle}
          prev={prevMonth === null ? null : { title: groupTitle(prevMonth), onGo: () => goToMonth(prevMonth) }}
          next={nextMonth === null ? null : { title: groupTitle(nextMonth), onGo: () => goToMonth(nextMonth) }}
          extra={<span className="gestao-nav-count">{eventsText(visibleRows.length)}</span>}
        />
        {monthKeys.length > 1 ? <MonthStrip chips={monthChips} onPick={(index) => goToMonth(index)} /> : null}
      </div>
    ) : null;
  const backwards = tab === "past";
  const monthFooter = (
    <MonthPagerFooter main={backwards ? "prev" : "next"} prev={pagerTarget(prevMonth)} next={pagerTarget(nextMonth)} />
  );

  // a tabela fica rente às bordas do card, como no Figma; cabeçalho, linhas e rodapé têm o respiro do card.
  // Título e "Novo evento" no alto, depois os filtros, o mês e a lista dele; no pé, o mês vizinho
  const eventsContent = (
    <>
      <div className={cx("px-6", teacherTabs ? "pt-[18px]" : "pt-6", manageableEvents.length ? "pb-5" : "pb-6")}>
        <div className="head">
          <div className="min-w-0">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="h2">
              {admin ? "Eventos da instituição" : "Eventos que você gerencia"}
            </h2>
            <p className="sub">{subtitle}</p>
          </div>
          {newEventButton}
        </div>

        {manageableEvents.length ? (
          <>
            {filters}
            {searchNote}
            {rows.length ? monthNav : null}
          </>
        ) : (
          <div className="empty-inline mt-5">
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
        )}
      </div>

      {/* com o card das datas ao lado, a lista estica (flex-1) e o pé do mês fica no fim do card (mt-auto) */}
      {manageableEvents.length ? (
        <div ref={listRef} className={cx(showSideOfficial && "flex flex-1 flex-col")}>
          {rows.length ? (
            tableWide ? (
              <>
                {/* a tabela troca de mês sem animação de entrada: o key faz o React montar o mês novo */}
                <div key={`${tab}-${shownMonth}`}>{table}</div>
                <div className="gestao-foot mt-auto px-6 pb-6">{monthFooter}</div>
              </>
            ) : (
              <div key={`${tab}-${shownMonth}`} className="px-6 pb-6">
                {cards}
                {monthFooter}
              </div>
            )
          ) : (
            <div className="px-6 pb-6">{emptyFiltered}</div>
          )}
        </div>
      ) : null}
    </>
  );

  const classTotal = classesSummary?.classes ?? classCount(assignments);
  const pendingTotal = classesSummary?.pending ?? 0;
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

  // overflow: clip (e não hidden) para o cabeçalho da tabela poder ficar preso no alto da tela. Na docente, as
  // abas Eventos e Minhas turmas ficam na linha do título, à direita (gestao.css, .gestao-tabcard), como o
  // título da administração vem antes de tudo; no card estreito, elas sobem para cima do título
  const listCard = teacherTabs ? (
    <section className="card gestao-tabcard rise min-w-0 overflow-clip" style={delay(0)}>
      <div className="docente-tabs-row">
        <div ref={paneTabsRef} className="seg docente-tabs" role="tablist" aria-label="Gestão">
          {paneTabs.map((item) => {
            const selected = pane === item.id;
            return (
              <button
                key={item.id}
                id={`${paneIds[item.id]}-aba`}
                className={cx(selected && "on")}
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
                  <span className="docente-tab-pend">{countText(pendingTotal, "pedido", "pedidos")}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={paneIds.events}
        role="tabpanel"
        aria-labelledby={`${paneIds.events}-aba`}
        hidden={pane !== "events"}
      >
        {eventsContent}
      </div>
      <div
        id={paneIds.classes}
        role="tabpanel"
        aria-labelledby={`${paneIds.classes}-aba`}
        hidden={pane !== "classes"}
      >
        <MyClasses
          context={context}
          search={menuSearch}
          onSearchCount={setClassesSearchCount}
          onSummary={setClassesSummary}
        />
      </div>
    </section>
  ) : (
    <section
      ref={listCardRef}
      className={cx("card rise min-w-0 overflow-clip", showSideOfficial && "flex flex-col self-stretch")}
      style={delay(0)}
      aria-labelledby={headingId}
    >
      {eventsContent}
    </section>
  );

  // ao lado: na administração, as próximas datas oficiais (só lado a lado, a partir de 1600px). Na docente,
  // os atalhos "Novo evento de ..." ficam embaixo da lista em qualquer largura, nas duas abas: ao lado, com
  // poucas linhas, o card curto deixava um vão de 200 a 400px até o fim da lista
  const sideCard = admin ? (
    showSideOfficial ? (
      <OfficialDatesCard
        events={officialSoon}
        limit={sideLimit}
        listed={officialListed}
        now={now}
        onEdit={onEdit}
        onNewEvent={onNewEvent}
        onShowAll={showAllOfficial}
      />
    ) : null
  ) : publishable.length ? (
    <AssignmentsCard assignments={publishable} events={manageableEvents} now={now} onNewEventFor={onNewEventFor} />
  ) : null;

  // lado a lado a partir de 1600px (só as datas oficiais): os dois terminam juntos (ver o efeito do
  // sideLimit) e o de lado fica parado no alto enquanto uma lista mais alta rola, se couber na tela. A
  // tabela da docente usa a largura toda, como no Figma. Com aviso embaixo, o fim da página ganha a altura
  // dele (o pé do #conteudo, growToastFoot no ui.tsx): rolando até o fim, nada clicável fica embaixo do aviso.
  const besideList = Boolean(sideCard) && admin;
  return (
    <div className={cx("manage-view grid items-start gap-5", besideList && SIDE_COLUMNS)}>
      {noAssignments && pane === "events" ? (
        <section className="card pad rise">
          <NoAssignmentsNotice heading="h2" />
        </section>
      ) : null}
      {listCard}
      {sideCard ? (
        besideList ? (
          <div ref={setSideNode} className="manage-side min-w-0">
            {sideCard}
          </div>
        ) : (
          <div className="min-w-0">{sideCard}</div>
        )
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card ao lado: vínculos do docente ou datas oficiais                 */
/* ------------------------------------------------------------------ */

function AssignmentsCard({
  assignments,
  events,
  now,
  onNewEventFor,
}: {
  assignments: TeachingAssignment[];
  events: AcademicEvent[];
  now: number;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
}) {
  const headingId = useId();
  return (
    <section className="card pad rise min-w-0" style={delay(1)} aria-labelledby={headingId}>
      <h2 id={headingId} className="h2">
        Disciplinas e turmas
      </h2>
      <p className="sub">Crie um evento já com a disciplina e a turma escolhidas.</p>
      <ul className="manage-side-list gestao-assign-list">
        {assignments.map((assignment) => {
          const subject = assignment.subject?.name ?? "Disciplina";
          const className = assignment.academicClass?.name ?? "Turma";
          const ahead = events.filter(
            (event) =>
              event.academicClassId === assignment.academicClassId &&
              event.subjectId === assignment.subjectId &&
              isOpen(event) &&
              tabOf(event, now) === "upcoming"
          ).length;
          return (
            <li key={assignment.id}>
              <button
                className="mini h-full items-center"
                aria-label={`Novo evento de ${subject} para ${className}`}
                onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                type="button"
              >
                <span className="mini-ico">
                  <Plus className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mini-t block wrap-anywhere">{`Novo evento de ${subject}`}</span>
                  <span className="mini-s block wrap-anywhere">
                    {[
                      className,
                      shiftLabel(assignment.academicClass?.shift),
                      ahead ? `${ahead} ${ahead === 1 ? "evento" : "eventos"} à frente` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Próximas datas oficiais (administração, só lado a lado com a lista): as abertas com algum dia de hoje em
 * diante, como no Painel, separadas por mês ("Janeiro de 2027"), porque cruzam meses e anos. O atalho no
 * pé leva a lista para Próximos, só as da instituição, mês a mês (N é o que a lista vai mostrar).
 */
function OfficialDatesCard({
  events,
  limit,
  listed,
  now,
  onEdit,
  onNewEvent,
  onShowAll,
}: {
  events: AcademicEvent[];
  /** Quantas datas cabem ao lado da lista (a ManageView mede). */
  limit: number;
  listed: number;
  now: number;
  onEdit: (event: AcademicEvent) => void;
  onNewEvent: () => void;
  onShowAll: () => void;
}) {
  const headingId = useId();
  const todayStart = startOfDay(new Date(now)).getTime();
  const shown = events.slice(0, limit);
  const groups = [...groupByMonth(shown, "upcoming", todayStart)];
  return (
    <section className="card pad rise min-w-0" style={delay(1)} aria-labelledby={headingId}>
      <h2 id={headingId} className="h2">
        Datas da instituição
      </h2>
      {/* vale para todas: a data pode ser de uma turma só, e a linha diz para quem é */}
      <p className="sub">Os próximos feriados, recessos e eventos institucionais.</p>
      {shown.length ? (
        groups.map(([month, items]) => (
          <div key={month} className="gestao-side-group">
            <h3 className="gestao-side-month">{groupTitle(month)}</h3>
            <ul className="manage-side-list">
              {items.map((event) => {
                const parts = dateParts(event.startsAt);
                const audience = event.academicClass?.name ?? "Toda a instituição";
                // a linha inteira abre o painel de edição: o texto fica com a largura toda do item
                // (título inteiro, como veio do PDF; quando e para quem em uma cada) e o lápis só indica a ação
                return (
                  <li key={event.id}>
                    <button
                      className="mini h-full items-center"
                      aria-label={`Editar ${event.title}, ${eventWhenLabel(event.startsAt, event.endsAt)}, ${event.academicClass?.name ?? "toda a instituição"}`}
                      onClick={() => onEdit(event)}
                      type="button"
                    >
                      <span className="ev-date bg-white">
                        <span className="dw">{parts.weekday}</span>
                        <span className="dn">{parts.day}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mini-t block wrap-anywhere">{event.title}</span>
                        <span className="mini-s block truncate">{sideWhen(event)}</span>
                        <span className="mini-s !mt-0 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{audience}</span>
                          <Pencil className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        <div className="empty-inline mt-4 !py-6">
          <p className="text-[15px] font-bold text-ink">Nenhuma data oficial à frente</p>
          <button className="btn btn-s btn-sm mt-2" onClick={onNewEvent} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            Novo evento oficial
          </button>
        </div>
      )}
      {shown.length > 0 && listed > shown.length ? (
        <button className="link gestao-side-link" onClick={onShowAll} type="button">
          {`Ver as ${listed} na lista`}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
