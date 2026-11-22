"use client";

import {
  CalendarRange,
  CalendarX2,
  Check,
  ChevronRight,
  History,
  Inbox,
  Info,
  ListChecks,
  Plus,
  Search,
  SearchX,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { addDays, cx, formatTime, isWholeDay, monthGroupLabel, monthTitle, startOfDay, weekRangeLabel } from "@/lib/format";
import { adminOnlyCategories, allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicClass, AcademicEvent, Category, UserRole } from "@/lib/types";
import { EventDetailContent, EventRow, eventLastDay, formatDayRange, type EventStatusChange } from "./event-bits";
import {
  MonthEmpty,
  MonthNeighbors,
  MonthPicker,
  currentMonthKey,
  monthBounds,
  monthTarget,
  monthYearTitle,
  nearestMonthWith,
  type MonthNoun,
  type PagerTarget,
} from "./month-pager";
import { Pager, usePaged } from "./pager";
import { Select, type SelectOption } from "./select";
import { Modal, PageHeader, Segmented, SegmentedButton } from "./ui";

export type CalendarMode = "list" | "month";
type TimeFilter = "upcoming" | "past" | "all";
type MonthCursor = { year: number; month: number };

const timeFilters: Array<{ value: TimeFilter; label: string }> = [
  { value: "upcoming", label: "Próximos" },
  { value: "past", label: "Passados" },
  { value: "all", label: "Todos" },
];

const periodNames: Record<TimeFilter, string> = { upcoming: "Próximos", past: "Passados", all: "Todos" };

const shortMonths = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Datas do campus (calendário oficial): linha mais baixa na Agenda, para as provas e trabalhos se destacarem. */
const campusCategories: Category[] = adminOnlyCategories;
const classCategories = allCategories.filter((category) => !campusCategories.includes(category));

/** Nomes de uma categoria só na contagem e nos vazios ("2 provas", "Nenhuma prova em dezembro"). */
const categoryNouns: Record<Category, { one: string; many: string; none: string }> = {
  exam: { one: "prova", many: "provas", none: "Nenhuma prova" },
  assignment: { one: "trabalho", many: "trabalhos", none: "Nenhum trabalho" },
  activity: { one: "atividade", many: "atividades", none: "Nenhuma atividade" },
  extracurricular: { one: "evento extracurricular", many: "eventos extracurriculares", none: "Nenhum evento extracurricular" },
  institutional: { one: "data institucional", many: "datas institucionais", none: "Nenhuma data institucional" },
  holiday: { one: "feriado", many: "feriados", none: "Nenhum feriado" },
  recess: { one: "recesso", many: "recessos", none: "Nenhum recesso" },
};
const eventNouns = { one: "evento", many: "eventos", none: "Nenhum evento" };
const resultNouns = { one: "resultado", many: "resultados", none: "Nenhum resultado" };

function inPeriod(event: AcademicEvent, period: TimeFilter) {
  if (period === "all") {
    return true;
  }
  // vale o último dia do evento (término às 00:00 não conta aquele dia)
  const todayStart = startOfDay(new Date()).getTime();
  const lastDay = eventLastDay(event).getTime();
  return period === "upcoming" ? lastDay >= todayStart : lastDay < todayStart;
}

/** Mês com prova ou trabalho ganha o marcador no seletor de mês. */
function isMarked(event: AcademicEvent) {
  return event.category === "exam" || event.category === "assignment";
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function byStart(a: AcademicEvent, b: AcademicEvent) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/* ------------------------------------------------------------------ */
/* Dias e meses                                                        */
/* ------------------------------------------------------------------ */

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthName(cursor: MonthCursor) {
  return new Date(cursor.year, cursor.month, 1).toLocaleDateString("pt-BR", { month: "long" });
}

/** "5 de novembro" e, fora do ano corrente, "1 de março de 2027". */
function dayAndMonth(date: Date) {
  const text = date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
  return date.getFullYear() === new Date().getFullYear() ? text : `${text} de ${date.getFullYear()}`;
}

/** "Quinta, 5 de novembro" ("Segunda, 1 de março de 2027" fora do ano corrente) */
function dayTitle(date: Date) {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayAndMonth(date)}`;
}

/** "quinta-feira, 5 de novembro, 3 eventos" (para o leitor de tela) */
function dayLabel(date: Date, count: number, today: boolean) {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" });
  const events = count ? plural(count, "evento", "eventos") : "nenhum evento";
  return `${today ? "hoje, " : ""}${weekday}, ${dayAndMonth(date)}, ${events}`;
}

/** Primeiro e último dia da grade do mês (semanas completas, domingo a sábado). */
function gridRange(cursor: MonthCursor) {
  const first = new Date(cursor.year, cursor.month, 1);
  const last = new Date(cursor.year, cursor.month + 1, 0);
  return { start: addDays(first, -first.getDay()), end: addDays(last, 6 - last.getDay()) };
}

function gridShows(cursor: MonthCursor, date: Date) {
  const { start, end } = gridRange(cursor);
  const time = startOfDay(date).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function eventSpan(event: AcademicEvent) {
  return { first: startOfDay(new Date(event.startsAt)).getTime(), last: eventLastDay(event).getTime() };
}

function occursOnDay(event: AcademicEvent, day: Date) {
  const span = eventSpan(event);
  const time = startOfDay(day).getTime();
  return span.first <= time && span.last >= time;
}

function occursInMonth(event: AcademicEvent, cursor: MonthCursor) {
  const span = eventSpan(event);
  return span.first <= new Date(cursor.year, cursor.month + 1, 0).getTime() && span.last >= new Date(cursor.year, cursor.month, 1).getTime();
}

/**
 * Ordem dos eventos num dia: primeiro o que é da turma (prova, trabalho, atividade, extracurricular), depois
 * feriado e recesso e por último as datas institucionais; no empate, pelo horário. Assim uma prova nunca fica
 * escondida no "+N" atrás de um "Período para..." que começa à meia-noite.
 */
function priorityOf(category: Category) {
  return classCategories.includes(category) ? 0 : category === "holiday" || category === "recess" ? 1 : 2;
}

function byPriority(a: AcademicEvent, b: AcademicEvent) {
  return priorityOf(a.category) - priorityOf(b.category) || byStart(a, b);
}

type DayCell = {
  key: string;
  date: Date;
  inMonth: boolean;
  today: boolean;
  /** Todos os eventos do dia, na ordem de prioridade. */
  events: AcademicEvent[];
  /** Eventos de um dia só que aparecem como chip no dia. */
  chips: AcademicEvent[];
  /** Eventos do dia que não aparecem (nem chip, nem faixa): o "+N". */
  hidden: number;
};

/** Faixa de um evento de vários dias numa semana: coluna de início (0 a 6), quantos dias e a linha dela. */
type WeekBar = {
  event: AcademicEvent;
  col: number;
  span: number;
  lane: number;
  fromBefore: boolean;
  toAfter: boolean;
  /** Todos os dias da faixa são de fora do mês (mais clara, como os chips desses dias). */
  out: boolean;
  dayKey: string;
};
type CalWeek = { cells: DayCell[]; bars: WeekBar[]; lanes: number };

/** Linhas de faixas por semana; o que passa disso entra no "+N" de cada dia. */
const MAX_LANES = 3;

function buildWeeks(cursor: MonthCursor, events: AcademicEvent[]): CalWeek[] {
  const { start, end } = gridRange(cursor);
  const todayKey = dayKey(new Date());
  const spans = events.map((event) => ({ event, ...eventSpan(event) }));
  const weeks: CalWeek[] = [];
  for (let weekStart = start; weekStart.getTime() <= end.getTime(); weekStart = addDays(weekStart, 7)) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const first = days[0].getTime();
    const last = days[6].getTime();
    // eventos de vários dias da semana viram faixas: o que é da turma primeiro, depois o que começa antes e o mais longo
    const multi = spans
      .filter((span) => span.last > span.first && span.first <= last && span.last >= first)
      .sort(
        (a, b) =>
          priorityOf(a.event.category) - priorityOf(b.event.category) ||
          a.first - b.first ||
          b.last - b.first - (a.last - a.first) ||
          byStart(a.event, b.event)
      );
    const laneEnds: number[] = [];
    const bars: WeekBar[] = [];
    const hiddenMulti = Array.from({ length: 7 }, () => 0);
    for (const span of multi) {
      const col = Math.round((Math.max(span.first, first) - first) / DAY_MS);
      const endCol = Math.round((Math.min(span.last, last) - first) / DAY_MS);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd < col);
      if (lane === -1) {
        lane = laneEnds.length;
      }
      if (lane >= MAX_LANES) {
        for (let index = col; index <= endCol; index += 1) {
          hiddenMulti[index] += 1;
        }
        continue;
      }
      laneEnds[lane] = endCol;
      bars.push({
        event: span.event,
        col,
        span: endCol - col + 1,
        lane,
        fromBefore: span.first < first,
        toAfter: span.last > last,
        out: days.slice(col, endCol + 1).every((day) => day.getMonth() !== cursor.month),
        dayKey: dayKey(days[col]),
      });
    }
    const lanes = laneEnds.length;
    // com 2 ou 3 linhas de faixas, cabe um chip por dia; com menos, dois
    const slots = lanes >= 2 ? 1 : 2;
    const cells = days.map((day, index) => {
      const time = day.getTime();
      const dayEvents = spans
        .filter((span) => span.first <= time && span.last >= time)
        .map((span) => span.event)
        .sort(byPriority);
      const singles = dayEvents.filter((event) => {
        const span = eventSpan(event);
        return span.last === span.first;
      });
      const chips = singles.slice(0, slots);
      return {
        key: dayKey(day),
        date: day,
        inMonth: day.getMonth() === cursor.month,
        today: dayKey(day) === todayKey,
        events: dayEvents,
        chips,
        hidden: singles.length - chips.length + hiddenMulti[index],
      };
    });
    weeks.push({ cells, bars, lanes });
  }
  return weeks;
}

/** Mesmo dia num mês vizinho (31/01 vira 28/02). */
function shiftMonthKeepDay(date: Date, delta: number) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + delta + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + delta, Math.min(date.getDate(), lastDay));
}

/* ------------------------------------------------------------------ */
/* Agenda mês a mês                                                    */
/* ------------------------------------------------------------------ */

/** ano * 12 + mês: os meses em ordem, para comparar e andar entre eles. */
function monthIndex(cursor: MonthCursor) {
  return cursor.year * 12 + cursor.month;
}

function indexMonth(index: number): MonthCursor {
  return { year: Math.floor(index / 12), month: index % 12 };
}

function monthIndexOf(time: number) {
  const date = new Date(time);
  return date.getFullYear() * 12 + date.getMonth();
}

function thisMonth(): MonthCursor {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** Nome do mês no cabeçalho, nas setas e no pé: "Novembro" no ano corrente, "Março de 2027" fora dele (decisão 2). */
function indexTitle(index: number) {
  const month = indexMonth(index);
  return monthGroupLabel(new Date(month.year, month.month, 1));
}

/**
 * Dias do evento que contam no período. Nos Próximos, os dias que já passaram de um evento em andamento
 * ficam de fora: ele aparece no mês de hoje, e não no mês em que começou.
 */
function periodSpan(event: AcademicEvent, period: TimeFilter, todayStart = startOfDay(new Date()).getTime()) {
  const span = eventSpan(event);
  return period === "upcoming" ? { first: Math.max(span.first, todayStart), last: span.last } : span;
}

/** Primeiro mês em que o evento aparece na Agenda. */
function listMonthOf(event: AcademicEvent, period: TimeFilter) {
  return indexMonth(monthIndexOf(periodSpan(event, period).first));
}

function inListMonth(event: AcademicEvent, period: TimeFilter, cursor: MonthCursor) {
  const span = periodSpan(event, period);
  const index = monthIndex(cursor);
  return monthIndexOf(span.first) <= index && monthIndexOf(span.last) >= index;
}

/** Evento na lista de um mês e o dia em que ele entra nela (o 1º dia dele no mês). */
type MonthItem = { event: AcademicEvent; day: number };

/**
 * Eventos de cada mês da Agenda, na ordem dos dias (em Passados, do mais recente). Um evento de vários
 * meses (um recesso de dezembro a janeiro) entra em cada um deles, como na grade do Calendário.
 */
function bucketByMonth(events: AcademicEvent[], period: TimeFilter) {
  const todayStart = startOfDay(new Date()).getTime();
  const months = new Map<number, MonthItem[]>();
  for (const event of events) {
    const span = periodSpan(event, period, todayStart);
    const last = monthIndexOf(span.last);
    for (let index = monthIndexOf(span.first); index <= last; index += 1) {
      const month = indexMonth(index);
      const item = { event, day: Math.max(span.first, new Date(month.year, month.month, 1).getTime()) };
      const items = months.get(index);
      if (items) {
        items.push(item);
      } else {
        months.set(index, [item]);
      }
    }
  }
  for (const items of months.values()) {
    items.sort((a, b) => a.day - b.day || byStart(a.event, b.event));
    if (period === "past") {
      items.reverse();
    }
  }
  return months;
}

/** Mês com eventos mais perto do pedido; no empate, o de depois (em Passados, o de antes). */
function nearestMonth(keys: number[], target: number, preferEarlier: boolean) {
  let best = keys[0];
  for (const key of keys) {
    const distance = Math.abs(key - target);
    const bestDistance = Math.abs(best - target);
    if (distance < bestDistance || (distance === bestDistance && (preferEarlier ? key < best : key > best))) {
      best = key;
    }
  }
  return best;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Resultados da busca por página (acima disso, o Pager no pé da lista). */
const SEARCH_PAGE = 12;

/** Domingo da semana do dia (as semanas da grade vão de domingo a sábado). */
function weekStartOf(time: number) {
  const day = startOfDay(new Date(time));
  return addDays(day, -day.getDay());
}

/**
 * "7 a 13 de dez" e "29 de nov a 5 de dez": o mesmo texto do Painel (weekRangeLabel, lib/format.ts). O ano de
 * referência é o do mês na tela: sob "Março de 2027" a linha não repete o ano. Na semana que cruza o ano, ele
 * aparece só no dia que não é do ano do cabeçalho ("27 de dez de 2026 a 2 de jan", sob "Janeiro de 2027").
 */
function weekRange(start: Date, refYear: number) {
  const end = addDays(start, 6);
  if (start.getFullYear() !== refYear && end.getFullYear() === refYear) {
    const head = weekRangeLabel(start, start, new Date(refYear, 6, 1)).replace(/^\d+ a /, "");
    return `${head} a ${weekRangeLabel(end, end, new Date(refYear, 6, 1)).replace(/^\d+ a /, "")}`;
  }
  return weekRangeLabel(start, end, new Date(refYear, 6, 1));
}

/** Rótulo da semana na Agenda: "Esta semana" com o intervalo ao lado, mais claro; as outras, só o intervalo. */
function weekLabel(start: Date, currentWeek: Date, refYear: number): { label: string; range?: string } {
  const offset = Math.round((start.getTime() - currentWeek.getTime()) / WEEK_MS);
  const range = weekRange(start, refYear);
  if (offset === 0) {
    return { label: "Esta semana", range };
  }
  if (offset === 1) {
    return { label: "Próxima semana", range };
  }
  if (offset === -1) {
    return { label: "Semana passada", range };
  }
  return { label: range };
}

type ListGroup = { label: string; range?: string; items: MonthItem[] };

/** Eventos do mês por semana, de domingo a sábado ("Esta semana 22 a 28 de nov", "29 de nov a 5 de dez"). */
function groupByWeek(items: MonthItem[], refYear: number) {
  const currentWeek = weekStartOf(Date.now());
  const groups: ListGroup[] = [];
  for (const item of items) {
    const { label, range } = weekLabel(weekStartOf(item.day), currentWeek, refYear);
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.range === range) {
      last.items.push(item);
    } else {
      groups.push({ label, range, items: [item] });
    }
  }
  return groups;
}

/** Resultado da busca na ordem dos dias, todos os meses juntos (em Passados, do mais recente). */
function searchOrder(events: AcademicEvent[], period: TimeFilter): MonthItem[] {
  const todayStart = startOfDay(new Date()).getTime();
  const ordered = events
    .map((event) => ({ event, day: periodSpan(event, period, todayStart).first }))
    .sort((a, b) => a.day - b.day || byStart(a.event, b.event));
  if (period === "past") {
    ordered.reverse();
  }
  return ordered;
}

/** Um grupo por mês, na ordem em que os itens vêm: "Dezembro", "Março de 2027" (o ano fora do ano corrente). */
function groupByMonth(items: MonthItem[]) {
  const groups: Array<{ key: number; label: string; items: MonthItem[] }> = [];
  for (const item of items) {
    const key = monthIndexOf(item.day);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: monthGroupLabel(new Date(item.day)), items: [item] });
    }
  }
  return groups;
}

/** Nome do mês em frase, com o ano só fora do ano corrente ("março de 2027", "dezembro"). */
function monthInText(index: number, withYear: boolean) {
  const month = indexMonth(index);
  const name = monthTitle(month.year, month.month).replace(/ de \d+$/, "").toLowerCase();
  return withYear ? `${name} de ${month.year}` : name;
}

/** Meses da busca: "em março de 2027", "de março a dezembro de 2027", "de novembro de 2026 a março de 2027". */
function monthSpanText(first: number, last: number) {
  const thisYear = new Date().getFullYear();
  const a = indexMonth(Math.min(first, last));
  const b = indexMonth(Math.max(first, last));
  if (a.year === b.year && a.month === b.month) {
    return `em ${monthInText(first, a.year !== thisYear)}`;
  }
  if (a.year === b.year) {
    return `de ${monthInText(Math.min(first, last), false)} a ${monthInText(Math.max(first, last), b.year !== thisYear)}`;
  }
  return `de ${monthInText(Math.min(first, last), true)} a ${monthInText(Math.max(first, last), true)}`;
}

/** Media query com matchMedia; falso até montar (sem diferença entre servidor e navegador). */
function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** "2 eventos" com espaço que não quebra: no botão estreito, o número não fica numa linha e a palavra na outra. */
function keepCount(target: PagerTarget | null): PagerTarget | null {
  return target ? { ...target, count: target.count.replace(/ /g, " ") } : null;
}

/** Alvo de um clique ou tecla que faz alguma coisa (botão, link, campo, interruptor). */
function isControl(target: EventTarget) {
  return target instanceof Element && target.closest("button, a[href], input, select, textarea, [role='switch']") !== null;
}

/** Dois quadros depois: passa na frente do foco e da rolagem que a casca faz ao trocar de tela. */
function afterPaint(callback: () => void) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
}

/** Topo do elemento na página, sem as animações de entrada (offsetTop ignora transform). */
function pageTop(element: HTMLElement) {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }
  return top;
}

const ASIDE_GAP = 20;
// folga entre o que a página traz para a tela (a linha escolhida, o dia e a lista dele) e as bordas dela
const EDGE_GAP = 16;

/**
 * Caixa do elemento na página, com as frações de pixel, como ela fica no fim das entradas animadas (.rise,
 * .pop) dele e dos blocos em volta. O getBoundingClientRect mede o quadro atual da animação (até 13 px fora),
 * e a soma dos offsetTop, que são inteiros, errava até 2 px. As animações vão até o fim só durante a medida
 * e voltam para onde estavam antes de a tela ser pintada de novo.
 */
function settledBox(element: HTMLElement) {
  const seeks: Array<[Animation, CSSNumberish]> = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const animations = typeof node.getAnimations === "function" ? node.getAnimations() : [];
    for (const animation of animations) {
      const time = animation.currentTime;
      const end = animation.effect?.getComputedTiming().endTime;
      if (time !== null && typeof end === "number" && Number.isFinite(end) && animation.playState === "running") {
        seeks.push([animation, time]);
        animation.currentTime = end;
      }
    }
  }
  const box = element.getBoundingClientRect();
  for (const [animation, time] of seeks) {
    animation.currentTime = time;
  }
  return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
}

/**
 * Maior rolagem com o começo do painel ao lado (título e data) à vista. O painel gruda no alto só até
 * onde a grade vai: daí para baixo ele sobe junto com a página.
 */
function asideStartLimit(aside: HTMLElement) {
  const grid = aside.parentElement;
  return grid ? pageTop(grid) + grid.offsetHeight - aside.offsetHeight - ASIDE_GAP : Number.POSITIVE_INFINITY;
}

/**
 * Folga no fim da Agenda com o detalhe ao lado (useAsideRoom): a altura que falta embaixo da última linha
 * para ela, a EDGE_GAP da borda de baixo, caber na tela junto com o começo do painel, preso no alto. Com
 * a lista mais curta que o painel, a grade já vai até o fim dele, e não há folga.
 */
function sizeAsideRoom(room: HTMLElement, list: HTMLElement, aside: HTMLElement) {
  const card = room.parentElement;
  const grid = aside.parentElement;
  const rows = list.querySelectorAll<HTMLElement>(".ev");
  const last = rows[rows.length - 1];
  let height = 0;
  if (card && grid && last) {
    const style = getComputedStyle(card);
    // onde o card da lista terminaria sem a folga
    const cardEnd =
      pageTop(room) + (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    // fim da grade com a última linha inteira na tela e o painel preso no alto
    const needed = pageTop(last) + last.offsetHeight + EDGE_GAP - window.innerHeight + ASIDE_GAP + aside.offsetHeight;
    if (needed > Math.max(cardEnd, pageTop(grid) + aside.offsetHeight)) {
      // 2 px a mais pelos arredondamentos do offsetTop
      height = Math.ceil(needed - cardEnd) + 2;
    }
  }
  const value = height ? `${height}px` : "";
  if (room.style.height !== value) {
    room.style.height = value;
  }
}

/** Até onde vai, no alto da tela, o cabeçalho DOM a SÁB quando gruda (no celular, abaixo do cabeçalho do app). */
function stuckHeadBottom(day: HTMLElement) {
  const head = day.closest(".cg")?.querySelector<HTMLElement>(".cg-dow");
  if (!head || getComputedStyle(head).position !== "sticky") {
    return 0;
  }
  return (Number.parseFloat(getComputedStyle(head).top) || 0) + head.offsetHeight;
}

/**
 * Rolagem do dia escolhido na grade. Parte do dia no mesmo lugar da tela (`top`), mesmo que a lista
 * de outro dia, acima dele, tenha saído. Com `list` (a lista do dia, logo abaixo da semana), desce só o
 * que falta para ela aparecer inteira; sem `list`, só traz o dia inteiro para a tela. O dia nunca fica
 * sob o cabeçalho DOM a SÁB: quando os dois não cabem juntos, valem o dia e o começo da lista, com o
 * título dela (que recebe o foco) sempre à vista.
 */
function placeDay(day: HTMLElement, top: number, list: HTMLElement | null, title: HTMLElement | null) {
  const safeTop = stuckHeadBottom(day) + EDGE_GAP;
  const safeBottom = window.innerHeight - EDGE_GAP;
  const dayTop = pageTop(day);
  const end = list ? pageTop(list) + list.offsetHeight : dayTop + day.offsetHeight;
  // parte do dia no mesmo lugar e desce até o fim aparecer, sem passar do ponto em que o dia encosta no cabeçalho
  let scroll = Math.min(Math.max(dayTop - top, end - safeBottom), dayTop - safeTop);
  if (title) {
    scroll = Math.max(scroll, pageTop(title) + title.offsetHeight - safeBottom);
  }
  scroll = Math.max(0, Math.round(scroll));
  if (scroll !== Math.round(window.scrollY)) {
    window.scrollTo({ top: scroll, behavior: "instant" });
  }
}

/**
 * Dia de um evento que chega de outro lugar (Painel, avisos, a Agenda), com a lista do dia aberta logo
 * abaixo da semana: o dia vai para o meio da tela e, se a lista não couber, a página desce até ela
 * aparecer inteira, sem levar o dia para baixo do cabeçalho DOM a SÁB. Com a lista mais alta que a
 * tela, a linha do evento (a marcada) fica à vista, mesmo que o dia suba.
 */
function placeDayWithEvent(day: HTMLElement, list: HTMLElement, row: HTMLElement | null) {
  const safeTop = stuckHeadBottom(day) + EDGE_GAP;
  const safeBottom = window.innerHeight - EDGE_GAP;
  const dayTop = pageTop(day);
  const listEnd = pageTop(list) + list.offsetHeight;
  let scroll = Math.min(
    Math.max(dayTop - (window.innerHeight - day.offsetHeight) / 2, listEnd - safeBottom),
    dayTop - safeTop
  );
  if (row) {
    const rowTop = pageTop(row);
    scroll = Math.min(Math.max(scroll, rowTop + row.offsetHeight - safeBottom), rowTop - safeTop);
  }
  scroll = Math.max(0, Math.round(scroll));
  if (scroll !== Math.round(window.scrollY)) {
    window.scrollTo({ top: scroll, behavior: "instant" });
  }
}

/**
 * Rola a página até o elemento ficar inteiro na tela, com a folga EDGE_GAP nas bordas (ou o scroll-margin
 * dele, quando é maior: o cabeçalho do celular em cima, os avisos embaixo). "nearest" rola só o que falta e
 * "center" leva o elemento ao meio. A medida é a do fim das entradas animadas (settledBox), para a linha
 * não ficar abaixo da borda quando a animação acaba. Com o painel ao lado (`aside`), o começo dele também
 * fica à vista sempre que cabe junto com o elemento (na Agenda, a folga do useAsideRoom garante isso);
 * quando não cabe, vale o elemento, e o painel sobe com a página.
 */
function revealElement(element: HTMLElement, block: "center" | "nearest", aside?: HTMLElement | null) {
  const box = settledBox(element);
  const style = getComputedStyle(element);
  const top = box.top - Math.max(EDGE_GAP, Number.parseFloat(style.scrollMarginTop) || 0);
  const bottom = box.bottom + Math.max(EDGE_GAP, Number.parseFloat(style.scrollMarginBottom) || 0);
  const viewHeight = window.innerHeight;
  const current = Math.round(window.scrollY);
  // rolagens com o elemento inteiro entre as folgas: da que deixa o fim dele embaixo até a que deixa o
  // começo em cima (mais alto que a tela, vale o começo)
  const maxScroll = Math.floor(top);
  const minScroll = Math.min(maxScroll, Math.ceil(bottom - viewHeight));
  let next = block === "center" ? Math.round((top + bottom - viewHeight) / 2) : current;
  next = Math.min(Math.max(next, minScroll), maxScroll);
  if (aside) {
    next = Math.max(Math.min(next, Math.floor(asideStartLimit(aside))), minScroll);
  }
  next = Math.max(0, next);
  if (next !== current) {
    window.scrollTo({ top: next, behavior: "instant" });
  }
}

/**
 * Painel ao lado sem rolagem própria (a roda sempre rola a página): preso no alto quando cabe na janela;
 * mais alto que ela, desce e sobe junto com a página até mostrar o fim ou o começo, e então fica preso.
 * Devolve a função que volta a mostrar o começo do painel.
 */
function useAsideFollow(ref: RefObject<HTMLElement | null>, active: boolean, resetKey: string) {
  const topRef = useRef(ASIDE_GAP);
  const holdUntil = useRef(0);

  useEffect(() => {
    const aside = ref.current;
    if (!active || !aside) {
      return;
    }
    let lastY = window.scrollY;
    const apply = () => {
      const lowest = Math.min(ASIDE_GAP, window.innerHeight - aside.offsetHeight - ASIDE_GAP);
      topRef.current = Math.min(ASIDE_GAP, Math.max(lowest, topRef.current));
      aside.style.top = `${topRef.current}px`;
    };
    const onScroll = () => {
      const y = window.scrollY;
      // a rolagem que o sistema faz logo depois de escolher um evento não esconde o começo do painel
      if (performance.now() > holdUntil.current) {
        topRef.current -= y - lastY;
      }
      lastY = y;
      apply();
    };
    const observer = new ResizeObserver(apply);
    observer.observe(aside);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", apply);
    apply();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", apply);
      aside.style.top = "";
    };
  }, [ref, active]);

  // começo do painel à vista; a rolagem que o sistema faz logo em seguida não o esconde
  const reset = useCallback(() => {
    topRef.current = ASIDE_GAP;
    holdUntil.current = performance.now() + 450;
    if (ref.current) {
      ref.current.style.top = `${ASIDE_GAP}px`;
    }
  }, [ref]);

  // outro evento: o painel volta a mostrar o começo
  useEffect(() => reset(), [reset, resetKey]);

  return reset;
}

/**
 * Folga no fim do card da Agenda enquanto o detalhe está ao lado. Mais alto que a janela, o painel subia
 * com a página perto do fim da lista, e a linha escolhida ou o começo do painel saía da tela. Com a folga,
 * qualquer linha (a última também) cabe na tela junto com o começo do painel, e no fim da página o card da
 * lista e o painel terminam juntos. A medida vale a cada render, antes de pintar, e quando a lista ou o
 * painel mudam de tamanho sozinhos (fontes, janela). A folga não muda o tamanho de nenhum dos dois.
 */
function useAsideRoom(
  roomRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  asideRef: RefObject<HTMLElement | null>,
  active: boolean
) {
  useLayoutEffect(() => {
    const room = roomRef.current;
    const list = listRef.current;
    const aside = asideRef.current;
    if (active && room && list && aside) {
      sizeAsideRoom(room, list, aside);
    }
  });

  useEffect(() => {
    const room = roomRef.current;
    const list = listRef.current;
    const aside = asideRef.current;
    if (!active || !room || !list || !aside) {
      return;
    }
    const update = () => sizeAsideRoom(room, list, aside);
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(aside);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active, roomRef, listRef, asideRef]);
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

function ListEmpty({ actions, hint, icon: Icon, title }: { actions?: ReactNode; hint?: string; icon: LucideIcon; title: string }) {
  return (
    <div className="empty-inline">
      <span className="empty-ico">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      {/* o termo da busca vem no título: uma palavra mais larga que o card quebra em vez de passar dele */}
      <p className="mt-2 text-[15px] font-semibold text-ink wrap-anywhere">{title}</p>
      {hint ? <p className="max-w-[44ch] text-sm leading-5 text-muted">{hint}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** Eventos de um dia escolhido no mês, logo abaixo da semana dele. */
function DayEvents({
  date,
  events,
  hideClass,
  highlight,
  level,
  selectedEventId,
  showTeacher,
  titleRef,
  onNewEventOn,
  onOpen,
}: {
  date: Date;
  events: AcademicEvent[];
  hideClass: boolean;
  /** Termo da busca, destacado nos títulos. */
  highlight?: string | null;
  level: 2 | 3;
  selectedEventId: number | null;
  showTeacher: (event: AcademicEvent) => boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  /** Quem pode criar evento: "Novo evento neste dia" no pé da lista, com a data preenchida. */
  onNewEventOn?: (date: Date) => void;
  onOpen: (id: number) => void;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div>
      <div className="cg-day-h">
        <Heading ref={titleRef} tabIndex={-1} className="cg-day-t">
          {dayTitle(date)}
        </Heading>
        <p className="cg-day-s">{events.length ? plural(events.length, "evento", "eventos") : "Nenhum evento neste dia."}</p>
      </div>
      {events.length ? (
        <div className="cg-day-list">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              hideClass={hideClass}
              hideDate
              highlight={highlight}
              selected={event.id === selectedEventId}
              showTeacher={showTeacher(event)}
              onClick={() => onOpen(event.id)}
            />
          ))}
        </div>
      ) : null}
      {onNewEventOn ? (
        <div className="cg-day-new">
          <button className="btn btn-g btn-sm" onClick={() => onNewEventOn(date)} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            Novo evento neste dia
          </button>
        </div>
      ) : null}
    </div>
  );
}

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "18:00" ou "dia todo", na dica e no nome dos eventos da grade. */
function whenShort(event: AcademicEvent) {
  return isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt);
}

function MonthCalendar({
  cursor,
  dayPanel,
  emptyNote,
  events,
  monthEventCount,
  picker,
  selectedDay,
  selectedEventId,
  setCursor,
  onOpenEvent,
  onSelectDay,
}: {
  cursor: MonthCursor;
  /** Aviso do mês sem eventos (acima da grade). */
  emptyNote?: ReactNode;
  /** Lista do dia escolhido: entra logo abaixo da semana dele (se o dia não está na grade mostrada, não aparece). */
  dayPanel?: ReactNode;
  events: AcademicEvent[];
  monthEventCount: number;
  /** Cabeçalho do card: o seletor de mês (MonthPicker), montado por quem tem as contagens. */
  picker: ReactNode;
  selectedDay: string | null;
  selectedEventId: number | null;
  setCursor: (cursor: MonthCursor) => void;
  onOpenEvent: (id: number, day: string) => void;
  onSelectDay: (day: string) => void;
}) {
  const weeks = useMemo(() => buildWeeks(cursor, events), [cursor, events]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const cells = weeks.flatMap((week) => week.cells);
  const keys = new Set(cells.map((cell) => cell.key));
  const firstOfMonth = cells.find((cell) => cell.inMonth)?.key ?? null;
  const todayCell = cells.find((cell) => cell.today)?.key ?? null;
  // tabulação em um dia só (setas andam entre os dias)
  const rovingKey = [activeDay, selectedDay, todayCell].find((key) => key !== null && keys.has(key)) ?? firstOfMonth;

  const present = allCategories.filter((category) =>
    cells.some((cell) => cell.inMonth && cell.events.some((event) => event.category === category))
  );

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) {
      return;
    }
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`);
    if (button) {
      pendingFocus.current = null;
      button.focus();
    }
  });

  function showMonthOf(date: Date) {
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  }

  function onGridKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    if (!key) {
      return;
    }
    const date = parseDayKey(key);
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -date.getDay()),
      End: () => addDays(date, 6 - date.getDay()),
      PageUp: () => shiftMonthKeepDay(date, -1),
      PageDown: () => shiftMonthKeepDay(date, 1),
    };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    const next = move();
    const nextKey = dayKey(next);
    setActiveDay(nextKey);
    pendingFocus.current = nextKey;
    if (!gridShows(cursor, next) || event.key === "PageUp" || event.key === "PageDown") {
      showMonthOf(next);
    }
  }

  /** O foco vai para o dia (ao fechar o detalhe, ele volta para lá) e o evento abre. */
  function openEvent(id: number, key: string) {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)?.focus({ preventScroll: true });
    setActiveDay(key);
    onOpenEvent(id, key);
  }

  return (
    <section className="card rise cg-card" aria-label="Calendário do mês">
      {picker}

      {monthEventCount === 0 ? (emptyNote ?? null) : null}

      <div ref={gridRef} className="cg" role="group" aria-label={monthYearTitle(monthIndex(cursor))} onKeyDown={onGridKey}>
        <div className="cg-dow" aria-hidden>
          {DOW.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <Fragment key={week.cells[0].key}>
            <div className={cx("cg-wk", week.lanes > 0 && "has-bars")} style={{ ["--lanes" as string]: week.lanes }}>
              {week.cells.map((cell, dayIndex) => {
                const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                const selected = cell.key === selectedDay;
                const dots = Array.from(new Set(cell.events.map((event) => event.category))).slice(0, 4);
                // o nome do mês no 1º dia dele e no 1º dia da grade ("31 jan", "1 fev")
                const showMonth = cell.date.getDate() === 1 || (weekIndex === 0 && dayIndex === 0);
                return (
                  <div
                    key={cell.key}
                    className={cx(
                      "cg-c",
                      !cell.inMonth && "out",
                      cell.today && "today",
                      weekend && "we",
                      selected && "sel",
                      cell.events.length >= 4 && "busy"
                    )}
                  >
                    {/* o botão do dia cobre a célula (::after): clicar no espaço livre abre a lista do dia */}
                    <button
                      aria-label={dayLabel(cell.date, cell.events.length, cell.today)}
                      aria-pressed={selected}
                      className="cg-hit"
                      data-day={cell.key}
                      onClick={() => onSelectDay(cell.key)}
                      onFocus={() => setActiveDay(cell.key)}
                      tabIndex={cell.key === rovingKey ? 0 : -1}
                      type="button"
                    >
                      <span className="cg-dn">{cell.date.getDate()}</span>
                      {showMonth ? <span className="cg-mon">{shortMonths[cell.date.getMonth()]}</span> : null}
                    </button>
                    {cell.events.length ? (
                      <div className="cg-items">
                        {/* lugar das faixas dos eventos de vários dias (desenhadas por cima, na semana) */}
                        {week.lanes ? <span className="cg-lanes" aria-hidden /> : null}
                        {cell.chips.map((event) => (
                          <button
                            key={event.id}
                            className={cx(
                              "cg-ev",
                              `k-${categoryMeta[event.category].tint}`,
                              classCategories.includes(event.category) && "full",
                              selectedEventId === event.id && "sel",
                              event.status === "cancelled" && "cancel"
                            )}
                            // pelo teclado, o evento está na lista do dia (Enter no dia)
                            tabIndex={-1}
                            onClick={() => openEvent(event.id, cell.key)}
                            // o nome inteiro e o horário na dica: no dia estreito o chip mostra só o título
                            title={`${event.title}, ${whenShort(event)}`}
                            type="button"
                          >
                            <i className={cx("dot", categoryMeta[event.category].accent)} aria-hidden />
                            <span className="tx">{event.title}</span>
                            {/* a hora vem depois do título e some quando o dia é estreito (cronograma.css) */}
                            {isWholeDay(event.startsAt, event.endsAt) ? null : (
                              <span className="tm">{formatTime(event.startsAt)}</span>
                            )}
                          </button>
                        ))}
                        {cell.hidden > 0 ? (
                          <button
                            aria-label={`Mais ${plural(cell.hidden, "evento", "eventos")} em ${dayAndMonth(cell.date)}`}
                            className={cx("cg-more", selected && "open")}
                            tabIndex={-1}
                            onClick={() => onSelectDay(cell.key)}
                            type="button"
                          >
                            +{cell.hidden} mais
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {dots.length ? (
                      <span className="cg-dots" aria-hidden>
                        {dots.map((category) => (
                          <span key={category} className={cx("dot", categoryMeta[category].accent)} />
                        ))}
                        {cell.events.length > 1 ? <span className="cg-count">{cell.events.length}</span> : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {/* eventos de vários dias: uma faixa por semana, do primeiro ao último dia dela, com o nome uma vez só
                  e o nome inteiro na dica. O clique abre o evento; pelo teclado, ele está na lista do dia. */}
              {week.bars.length ? (
                <div className="cg-bars" aria-hidden>
                  {week.bars.map((bar) => (
                    <span
                      key={bar.event.id}
                      className={cx(
                        "cg-bar",
                        `k-${categoryMeta[bar.event.category].tint}`,
                        bar.fromBefore && "from-before",
                        bar.toAfter && "to-after",
                        bar.out && "out",
                        selectedEventId === bar.event.id && "sel",
                        bar.event.status === "cancelled" && "cancel"
                      )}
                      style={{ gridColumn: `${bar.col + 1} / span ${bar.span}`, gridRow: bar.lane + 1 }}
                      title={`${bar.event.title}, ${formatDayRange(bar.event)}`}
                      onClick={() => openEvent(bar.event.id, bar.dayKey)}
                    >
                      <span className="cg-bar-t">{bar.event.title}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {/* a lista do dia abre embaixo da semana dele: o dia e os eventos cabem juntos na tela */}
            {selectedDay && week.cells.some((cell) => cell.key === selectedDay) ? dayPanel : null}
          </Fragment>
        ))}
      </div>

      {/* pé: legenda das cores e os atalhos do teclado */}
      <div className="cg-foot">
        <p className="cg-keys">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Setas andam pelos dias, <span className="kbd">PgUp</span> <span className="kbd">PgDn</span> trocam o mês,{" "}
            <span className="kbd">Enter</span> abre o dia.
          </span>
        </p>
        {present.length ? (
          <ul className="cg-leg" aria-label="Cores das categorias">
            {present.map((category) => (
              <li key={category}>
                <span className={cx("dot", categoryMeta[category].accent)} aria-hidden />
                {categoryMeta[category].label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Cronograma                                                          */
/* ------------------------------------------------------------------ */

function selectionKey(id: number | null, event: AcademicEvent | null) {
  return id === null ? "" : `${id}:${event ? 1 : 0}`;
}

function noticeFor(event: AcademicEvent, from: TimeFilter) {
  return from === "upcoming"
    ? `Mostrando Todos para incluir "${event.title}", que já passou.`
    : `Mostrando Todos para incluir "${event.title}", que ainda vai acontecer.`;
}

export function CalendarView({
  allEvents,
  calendarMode,
  canManageEvent,
  classes,
  events,
  noClass = false,
  reminderOffset,
  role,
  saving,
  search,
  selectedCategories,
  selectedEvent,
  selectedEventId,
  setCalendarMode,
  setCategories,
  setReminderOffset,
  setSearch,
  studentName,
  toggleCategory,
  onDelete,
  onEdit,
  onNewEventOn,
  onRemoveReminder,
  onSaveReminder,
  onSelect,
  onSetStatus,
}: {
  /** Eventos já filtrados pela busca e sem o filtro de categoria, para as contagens dos chips. */
  allEvents?: AcademicEvent[];
  calendarMode: CalendarMode;
  canManageEvent: (event: AcademicEvent) => boolean;
  classes: AcademicClass[];
  events: AcademicEvent[];
  /** Aluno ainda sem turma: o título vira "Cronograma" e o subtítulo convida a entrar numa turma. */
  noClass?: boolean;
  reminderOffset: string;
  role: UserRole;
  saving: boolean;
  search: string;
  selectedCategories: Category[];
  selectedEvent: AcademicEvent | null;
  selectedEventId: number | null;
  setCalendarMode: (mode: CalendarMode) => void;
  setCategories?: (categories: Category[]) => void;
  setReminderOffset: (value: string) => void;
  setSearch: (value: string) => void;
  /** Responsável: o primeiro nome do aluno acompanhado ("Cronograma de Diogo"). */
  studentName?: string | null;
  toggleCategory: (category: Category) => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  /**
   * Quem pode criar evento (o page.tsx passa só para esses perfis): a lista do dia no Calendário ganha
   * "Novo evento neste dia", que abre o Novo evento com a data do dia.
   */
  onNewEventOn?: (date: Date) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSelect: (id: number | null) => void;
  onSetStatus: (event: AcademicEvent, status: EventStatusChange) => void;
}) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const narrow = useMediaQuery("(max-width: 1279px)");
  const monthMode = calendarMode === "month";
  // painel ao lado só no computador e só na Agenda. No Calendário ele deixaria cada dia com no máximo
  // uns 110 px (a casca vai até 1560 px) e os títulos não caberiam: a grade fica larga, a lista do dia
  // abre embaixo da semana dele (o dia e os eventos cabem juntos na tela) e o detalhe abre no Modal,
  // por cima. Os dois ficam falsos até montar.
  const side = wide && !monthMode;
  const compact = (wide || narrow) && !side;

  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() =>
    selectedEvent && !inPeriod(selectedEvent, "upcoming") ? "all" : "upcoming"
  );
  const [periodNotice, setPeriodNotice] = useState<string | null>(() =>
    selectedEvent && !inPeriod(selectedEvent, "upcoming") ? noticeFor(selectedEvent, "upcoming") : null
  );
  const [mineOnly, setMineOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("all");
  // mês da Agenda e do Calendário, o mesmo nas duas vistas (trocar de vista mantém o mês). Chegando com um
  // evento (endereço, Painel, avisos), começa no mês dele; sem evento, no mês de hoje: na Agenda, a lista vai
  // para o mês com eventos mais perto (nos Próximos, o primeiro à frente; em Passados, o mais recente)
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    if (!selectedEvent) {
      return thisMonth();
    }
    if (calendarMode === "month") {
      const start = new Date(selectedEvent.startsAt);
      return { year: start.getFullYear(), month: start.getMonth() };
    }
    return listMonthOf(selectedEvent, inPeriod(selectedEvent, "upcoming") ? "upcoming" : "all");
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    calendarMode === "month" && selectedEvent ? dayKey(new Date(selectedEvent.startsAt)) : null
  );
  // último evento escolhido aqui dentro (lista, grade ou dia): esse já está à vista
  const [internalId, setInternalId] = useState<number | null>(null);
  // evento que chega de fora (Painel, avisos, endereço) numa categoria fora do filtro que ficou da última
  // visita: o filtro volta a Todas (no efeito abaixo) e, até lá, a Agenda não troca de mês
  const [catFix, setCatFix] = useState<number | null>(() =>
    selectedEvent && !selectedCategories.includes(selectedEvent.category) ? selectedEvent.id : null
  );
  if (catFix !== null && (selectedEvent?.id !== catFix || selectedCategories.includes(selectedEvent.category))) {
    setCatFix(null);
  }
  useEffect(() => {
    if (catFix === null) {
      return;
    }
    if (setCategories) {
      setCategories(allCategories);
    } else if (selectedEvent) {
      toggleCategory(selectedEvent.category);
    }
  }, [catFix, selectedEvent, setCategories, toggleCategory]);
  // o mesmo com a busca que ficou da visita anterior: o evento que chega de fora e não aparece nela limpa a
  // busca (no efeito abaixo) e, até lá, a Agenda não troca de mês nem mostra o aviso de filtro
  const [searchFix, setSearchFix] = useState<number | null>(() =>
    selectedEvent && search.trim() && allEvents && !allEvents.some((event) => event.id === selectedEvent.id)
      ? selectedEvent.id
      : null
  );
  if (searchFix !== null && (selectedEvent?.id !== searchFix || !search.trim())) {
    setSearchFix(null);
  }
  useEffect(() => {
    if (searchFix !== null) {
      setSearch("");
    }
  }, [searchFix, setSearch]);

  // evento escolhido de outro lugar (Painel, avisos) ou salvo com outra data: deixa à vista (período, mês e dia)
  const currentKey = selectionKey(selectedEventId, selectedEvent);
  // o instante (e não o texto), para a mesma data em outro formato não contar como mudança
  const currentStart = selectedEvent ? new Date(selectedEvent.startsAt).getTime() : null;
  const [tracked, setTracked] = useState({ key: currentKey, start: currentStart });
  if (tracked.key !== currentKey || tracked.start !== currentStart) {
    // o mesmo evento mudou de data: a lista e o mês vão atrás dele, mesmo se foi escolhido aqui
    const moved = tracked.key === currentKey && tracked.start !== null && currentStart !== null;
    setTracked({ key: currentKey, start: currentStart });
    if (selectedEvent && (moved || selectedEvent.id !== internalId)) {
      if (!selectedCategories.includes(selectedEvent.category)) {
        setCatFix(selectedEvent.id);
      }
      if (search.trim() && allEvents && !allEvents.some((event) => event.id === selectedEvent.id)) {
        setSearchFix(selectedEvent.id);
      }
      let period = timeFilter;
      if (!inPeriod(selectedEvent, timeFilter)) {
        setPeriodNotice(noticeFor(selectedEvent, timeFilter));
        setTimeFilter("all");
        period = "all";
      }
      const start = new Date(selectedEvent.startsAt);
      if (calendarMode === "month") {
        if (!gridShows(cursor, start)) {
          setCursor({ year: start.getFullYear(), month: start.getMonth() });
        }
        if (!(selectedDay && occursOnDay(selectedEvent, parseDayKey(selectedDay)))) {
          setSelectedDay(dayKey(start));
        }
      } else if (!inListMonth(selectedEvent, period, cursor)) {
        // Agenda: vai para o mês do evento (endereço, busca do menu, Painel), onde a linha dele aparece
        setCursor(listMonthOf(selectedEvent, period));
      }
    } else if (selectedEventId === null) {
      setPeriodNotice(null);
    }
  }

  // evento aberto ao lado, na Agenda, quando a pessoa passa para o Calendário: fica marcado no dia e na
  // lista do dia, mas o diálogo só abre quando ela clica nele (trocar de modo não abre diálogo sozinho).
  // Vale só para esse evento: outro evento, ou o mesmo escolhido de novo depois de fechar, abre como sempre.
  const [quietId, setQuietId] = useState<number | null>(null);
  if (quietId !== null && quietId !== selectedEventId) {
    setQuietId(null);
  }
  const quiet = quietId !== null && quietId === selectedEventId;

  // a tela inteira (cabeçalho, filtros, lista ou grade): as buscas por linha, dia e aba partem daqui
  const sectionRef = useRef<HTMLDivElement>(null);
  // rodapé do Modal do detalhe, onde o detalhe põe a ação principal
  const [modalFoot, setModalFoot] = useState<HTMLDivElement | null>(null);
  const listId = useId();
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const dayTitleRef = useRef<HTMLHeadingElement>(null);
  const dayPanelRef = useRef<HTMLElement>(null);
  const allChipRef = useRef<HTMLButtonElement>(null);
  // categorias: no celular, uma faixa que rola de lado (cronograma.css)
  const catsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const asideRoomRef = useRef<HTMLDivElement>(null);
  // título do seletor de mês da Agenda: o pé da lista leva a página até ele e o foco para lá
  const monthTitleRef = useRef<HTMLElement>(null);
  // linha "28 resultados de março a dezembro de 2027": o Pager da busca leva o foco e a página até ela
  const searchHeadRef = useRef<HTMLParagraphElement>(null);
  // evento, modo e data para os quais a página já rolou até a linha ou o dia
  const scrolledFor = useRef<{ id: number; mode: CalendarMode; start: number | null } | null>(null);
  const pendingFocus = useRef<"detail" | null>(null);
  // dia escolhido na grade e onde ele estava na tela: fica no mesmo lugar quando a lista muda de semana,
  // e com `list` a página desce só o que falta para a lista dele aparecer (e o foco vai para ela)
  const dayAnchor = useRef<{ key: string; top: number; list: boolean } | null>(null);

  const scope = useCallback(
    (list: AcademicEvent[]) => {
      let scoped = list;
      if (role === "teacher" && mineOnly) {
        scoped = scoped.filter(canManageEvent);
      }
      if (role === "admin" && classFilter !== "all") {
        scoped =
          classFilter === "official"
            ? scoped.filter((event) => !event.academicClassId)
            : scoped.filter((event) => event.academicClassId === Number(classFilter));
      }
      return scoped;
    },
    [role, mineOnly, classFilter, canManageEvent]
  );

  const term = search.trim();
  const scopedEvents = useMemo(() => scope(events), [scope, events]);
  const listEvents = useMemo(() => scopedEvents.filter((event) => inPeriod(event, timeFilter)), [scopedEvents, timeFilter]);
  const monthEvents = useMemo(() => scopedEvents.filter((event) => occursInMonth(event, cursor)), [scopedEvents, cursor]);

  // Agenda mês a mês: os meses com eventos no filtro (período, categorias, turma) e o mês na tela
  const months = useMemo(() => bucketByMonth(listEvents, timeFilter), [listEvents, timeFilter]);
  const monthKeys = useMemo(() => [...months.keys()].sort((a, b) => a - b), [months]);
  // Calendário: quantos eventos acontecem em cada mês (com busca, os resultados), para o seletor de mês
  const calMonths = useMemo(() => bucketByMonth(scopedEvents, "all"), [scopedEvents]);
  const calCounts = useMemo(() => new Map([...calMonths].map(([key, items]) => [key, items.length])), [calMonths]);
  const calMarks = useMemo(
    () => new Set([...calMonths].filter(([, items]) => items.some((item) => isMarked(item.event))).map(([key]) => key)),
    [calMonths]
  );
  // o mês do cursor entra nos limites: depois de filtrar, o mês na tela pode ficar fora dos meses com eventos
  // (Janeiro de 2028 com o chip Provas); sem isso as setas travam e o vazio não acha o mês com eventos
  const calBounds = useMemo(() => monthBounds([...calMonths.keys(), monthIndex(cursor)]), [calMonths, cursor]);
  // Agenda sem o filtro de categoria (mesmo período, turma e "Só meus"): quanto o filtro esconde em cada mês
  const allListMonths = useMemo(
    () => (allEvents ? bucketByMonth(scope(allEvents).filter((event) => inPeriod(event, timeFilter)), timeFilter) : null),
    [allEvents, scope, timeFilter]
  );
  const filterKey = `${timeFilter}|${selectedCategories.join(",")}|${mineOnly ? 1 : 0}|${classFilter}`;
  const cursorIndex = monthIndex(cursor);
  // a Agenda mostra o mês do seletor, mesmo vazio (dezembro sem eventos continua navegável, com o vazio útil);
  // o filtro não troca o mês sozinho
  const shownIndex: number | null = monthKeys.length ? cursorIndex : null;
  // quantos eventos cada mês mostra na lista (o que começou antes e continua conta nos dois meses)
  const listCounts = useMemo(() => new Map([...months].map(([key, items]) => [key, items.length])), [months]);
  const listMarks = useMemo(
    () => new Set([...months].filter(([, items]) => items.some((item) => isMarked(item.event))).map(([key]) => key)),
    [months]
  );
  // limites do mês na Agenda, como na Gestão: em Próximos, nada antes do mês de hoje (o "‹" do topo fica sem mês
  // anterior e o pé não oferece "Outubro, nenhum evento"); em Passados, nada depois dele. O mês na tela e um mês
  // com evento (o recesso que começou antes e continua) ficam sempre dentro
  const listBounds = useMemo(() => {
    const bounds = monthBounds([...monthKeys, cursorIndex]);
    const today = currentMonthKey();
    const first = Math.min(today, cursorIndex, monthKeys[0] ?? today);
    const last = Math.max(today, cursorIndex, monthKeys[monthKeys.length - 1] ?? today);
    return {
      min: timeFilter === "upcoming" ? Math.max(bounds.min, first) : bounds.min,
      max: timeFilter === "past" ? Math.min(bounds.max, last) : bounds.max,
    };
  }, [monthKeys, cursorIndex, timeFilter]);
  // busca na Agenda: os resultados de todos os meses, agrupados por mês, 12 por página
  const searchItems = useMemo(() => (term ? searchOrder(listEvents, timeFilter) : []), [term, listEvents, timeFilter]);
  const searchPage = usePaged(searchItems, SEARCH_PAGE, `${term}|${filterKey}`);
  // evento escolhido de fora (Painel, avisos, endereço) que está em outra página da busca: a página vai até ele
  const pageKey = term && selectedEventId !== null ? `${selectedEventId}|${term}|${filterKey}` : null;
  const [pagedFor, setPagedFor] = useState<string | null>(null);
  if (pageKey !== pagedFor) {
    setPagedFor(pageKey);
    const position = pageKey ? searchItems.findIndex((item) => item.event.id === selectedEventId) : -1;
    const page = Math.floor(position / SEARCH_PAGE) + 1;
    if (position >= 0 && page !== searchPage.page) {
      searchPage.setPage(page);
    }
  }
  const shownItems = shownIndex === null ? [] : (months.get(shownIndex) ?? []);
  // meses com eventos mais perto, antes e depois do mês na tela (o vazio leva a eles)
  const prevIndex = shownIndex === null ? null : nearestMonthWith(listCounts, shownIndex, -1, listBounds);
  const nextIndex = shownIndex === null ? null : nearestMonthWith(listCounts, shownIndex, 1, listBounds);

  // chips de categoria: a mesma lista e a mesma contagem na Agenda e no Calendário. Contam o cronograma
  // inteiro (todos os períodos e meses) no perfil, na turma, no "Só meus" e na busca, como o "N eventos no
  // total"; o período tem as próprias contagens nas abas e o mês, no seletor de mês
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(allCategories.map((category) => [category, 0])) as Record<Category, number>;
    for (const event of scope(allEvents ?? events)) {
      counts[event.category] += 1;
    }
    return counts;
  }, [allEvents, events, scope]);

  // o que a tela mostra por categoria, para dizer quanto o filtro esconde: o período da Agenda ou, no
  // Calendário, o mês que está na tela (com busca, todos os meses, como a faixa dos meses com resultado)
  const viewCounts = useMemo(() => {
    const counts = Object.fromEntries(allCategories.map((category) => [category, 0])) as Record<Category, number>;
    for (const event of scope(allEvents ?? events)) {
      if (monthMode ? Boolean(term) || occursInMonth(event, cursor) : inPeriod(event, timeFilter)) {
        counts[event.category] += 1;
      }
    }
    return counts;
  }, [allEvents, events, scope, monthMode, cursor, timeFilter, term]);

  const otherPeriod: TimeFilter | null = timeFilter === "upcoming" ? "past" : timeFilter === "past" ? "upcoming" : null;
  const otherCount = otherPeriod ? scopedEvents.filter((event) => inPeriod(event, otherPeriod)).length : 0;
  // categorias que têm algum evento (em qualquer período ou mês), para o perfil e a busca de agora
  const livePresent = useMemo(
    () => (allEvents ? new Set(scope(allEvents).map((event) => event.category)) : null),
    [allEvents, scope]
  );
  // allEvents já chega filtrado pela busca: com busca, vale o conjunto de antes dela, para o chip marcado não
  // trocar a cada letra (nem "Todas" esconder a categoria escolhida, que voltaria quando a busca sai)
  const [basePresent, setBasePresent] = useState<Set<Category> | null>(() => (term ? null : livePresent));
  if (!term && basePresent !== livePresent) {
    setBasePresent(livePresent);
  }
  const presentCategories = term ? basePresent : livePresent;
  // uma escolha que cobre todas as categorias com eventos não esconde nada: vale como "Todas" (o "Ver todas no
  // cronograma" do Painel marca as datas da instituição, e quem não tem provas via um filtro que não filtrava)
  const allSelected =
    selectedCategories.length === allCategories.length ||
    (presentCategories !== null &&
      allCategories.every((category) => selectedCategories.includes(category) || !presentCategories.has(category)));
  const pickedWithEvents = selectedCategories.some((category) => categoryCounts[category] > 0);
  const narrowed = !allSelected || mineOnly || classFilter !== "all";
  // a aba Próximos, Passados ou Todos não é filtro: sozinha, ela não mostra o "Limpar filtros"
  const hasFilter = Boolean(term) || narrowed;
  // uma categoria só: "2 provas", "Nenhuma prova em dezembro"
  const singleCategory = !allSelected && selectedCategories.length === 1 ? selectedCategories[0] : null;
  const nouns = term ? resultNouns : singleCategory ? categoryNouns[singleCategory] : eventNouns;
  const countText = (count: number) => plural(count, nouns.one, nouns.many);

  // total das categorias (o que a tela teria sem o filtro de categoria) e quanto o filtro esconde dele: na busca,
  // a tela diz "2 escondidos pelo filtro" e oferece mostrar (decisão 14)
  const totalCount = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
  const viewTotal = Object.values(viewCounts).reduce((sum, count) => sum + count, 0);
  const shownCount = monthMode ? (term ? scopedEvents.length : monthEvents.length) : listEvents.length;
  const hiddenCount = allSelected ? 0 : Math.max(0, viewTotal - shownCount);
  const hiddenText = plural(hiddenCount, "escondido", "escondidos") + " pelo filtro";
  // sem nada para mostrar nem filtro ativo, a linha das categorias some (o "Todas 0" sozinho não dizia nada).
  // No Calendário sem busca ela fica, para a linha não sumir e voltar a cada mês vazio
  const hideCats = totalCount === 0 && !narrowed && (Boolean(term) || calendarMode === "list");

  const counterText =
    calendarMode === "month"
      ? `${term ? plural(monthEvents.length, "encontrado", "encontrados") : countText(monthEvents.length)} em ${monthName(cursor)}`
      : term
        ? plural(listEvents.length, "encontrado", "encontrados")
        : timeFilter === "upcoming"
          ? plural(listEvents.length, "próximo", "próximos")
          : timeFilter === "past"
            ? plural(listEvents.length, "passado", "passados")
            : plural(listEvents.length, "evento", "eventos");

  const selectedDayDate = selectedDay ? parseDayKey(selectedDay) : null;
  const dayEvents = selectedDayDate
    ? scopedEvents.filter((event) => occursOnDay(event, selectedDayDate)).sort(byPriority)
    : [];

  // Calendário com busca: os meses com resultado (faixa no alto) e, quando a busca ou os filtros mudam e o
  // mês na tela fica vazio, a grade vai para o mês com resultado mais perto (e não fica num mês em branco)
  const searchMonths = useMemo(() => (term ? bucketByMonth(scopedEvents, "all") : null), [term, scopedEvents]);
  const searchMonthKeys = useMemo(() => (searchMonths ? [...searchMonths.keys()].sort((a, b) => a - b) : []), [searchMonths]);
  const jumpKey = monthMode && term ? `${term}|${filterKey}` : null;
  const [jumpedFor, setJumpedFor] = useState<string | null>(null);
  // mês em que a pessoa estava quando começou a buscar: a cada letra a grade pode ir para outro mês, e
  // quando o termo final não acha nada ela volta para ele (e não fica num mês qualquer, longe de hoje)
  const [searchFrom, setSearchFrom] = useState<MonthCursor | null>(null);
  if (term && searchFrom === null) {
    setSearchFrom(cursor);
  } else if (!term && searchFrom !== null) {
    setSearchFrom(null);
  }
  if (jumpKey !== jumpedFor) {
    setJumpedFor(jumpKey);
    const origin = searchFrom ?? cursor;
    if (jumpKey && searchMonthKeys.length && monthEvents.length === 0) {
      const target = indexMonth(nearestMonth(searchMonthKeys, monthIndex(origin), false));
      setCursor(target);
      setSelectedDay(null);
    } else if (jumpKey && !searchMonthKeys.length && monthIndex(origin) !== cursorIndex) {
      setCursor(origin);
      setSelectedDay(null);
    }
  }
  // a busca não é filtro aqui: ela tem o próprio X no chip "Busca: termo". O "Limpar filtros" aparece só com
  // filtro além dela (categoria, "Só meus", turma), e não repete uma ação que já está logo abaixo (decisão 13):
  // - com busca e o filtro escondendo resultados, o "Mostrar todos N" (linha dos resultados, vazio ou aviso do
  //   mês) já volta as categorias; com só categoria escolhida, o "Limpar filtros" faria o mesmo;
  // - o vazio (ou o aviso do Calendário sem resultado) que já tem o próprio "Limpar filtros"
  const showAllOffer = Boolean(term) && hiddenCount > 0;
  const onlyCategories = !mineOnly && classFilter === "all";
  const emptyHasClear =
    narrowed && !showAllOffer && (monthMode ? Boolean(term) && !searchMonthKeys.length : !listEvents.length);
  const showClear = narrowed && !emptyHasClear && !(showAllOffer && onlyCategories);
  // Calendário com busca e resultados: quantos o filtro esconde (em todos os meses) e o "Mostrar todos", também
  // no celular (decisão 14); sem resultado, o aviso do mês já diz isso
  const calHiddenLine = monthMode && showAllOffer && searchMonthKeys.length > 0;
  // contagem de cada período nas abas ("Próximos 118")
  const periodCounts = useMemo(() => {
    const counts: Record<TimeFilter, number> = { upcoming: 0, past: 0, all: scopedEvents.length };
    for (const event of scopedEvents) {
      counts[inPeriod(event, "upcoming") ? "upcoming" : "past"] += 1;
    }
    return counts;
  }, [scopedEvents]);
  // Agenda no computador sem evento escolhido: o painel ao lado já mostra o 1º evento da lista na tela (o
  // próximo, em Próximos), como na amostra, em vez de a lista esticar pela tela toda. É uma prévia: a escolha
  // (e o endereço) só muda quando a pessoa clica numa linha ou usa algo do painel (adoptPreview)
  const previewEvent =
    side && selectedEventId === null && !periodNotice
      ? ((term ? searchPage.items[0]?.event : shownItems[0]?.event) ?? null)
      : null;
  const detailEvent = selectedEvent ?? previewEvent;
  const asideOpen = side && detailEvent !== null;
  const asideRef = useRef<HTMLElement>(null);
  // a prévia que vira escolha não leva o foco para o título (a pessoa já está no painel)
  const quietAsideFocus = useRef(false);
  const resetAside = useAsideFollow(asideRef, asideOpen, String(detailEvent?.id ?? ""));
  useAsideRoom(asideRoomRef, listRef, asideRef, asideOpen);
  const hiddenByFilters =
    !monthMode && catFix === null && searchFix === null && selectedEvent !== null && !periodNotice && !listEvents.some((event) => event.id === selectedEvent.id);

  const showTeacher = useCallback(
    (event: AcademicEvent) => (role === "teacher" ? !canManageEvent(event) : role === "admin" && event.source === "teacher"),
    [role, canManageEvent]
  );

  // evento escolhido (aqui, no Painel, nos avisos ou na busca): a página rola até a linha ou o dia dele,
  // sem rolar se já está à vista. O mesmo evento num lugar novo (salvo com outra data, ou o outro modo)
  // vai para o centro: a lista acompanha o evento. No Calendário, com a lista do dia aberta, o dia, a
  // lista e a linha do evento ficam à vista juntos; com um clique na própria grade, nada rola (o que foi
  // clicado já está à vista e não sai de baixo do cursor).
  const targetDay = selectedDay ?? (selectedEvent ? dayKey(new Date(selectedEvent.startsAt)) : null);
  const targetVisible =
    selectedEventId !== null &&
    selectedEvent !== null &&
    (monthMode
      ? targetDay !== null && gridShows(cursor, parseDayKey(targetDay))
      : term
        ? searchPage.items.some((item) => item.event.id === selectedEventId)
        : shownItems.some((item) => item.event.id === selectedEventId));
  useEffect(() => {
    if (selectedEventId === null || !targetVisible) {
      return;
    }
    const last = scrolledFor.current;
    if (last && last.id === selectedEventId && last.mode === calendarMode && last.start === currentStart) {
      return;
    }
    scrolledFor.current = { id: selectedEventId, mode: calendarMode, start: currentStart };
    const relocated = last?.id === selectedEventId;
    const fromHere = !relocated && internalId === selectedEventId;
    afterPaint(() => {
      const root = sectionRef.current;
      if (monthMode) {
        const day = root?.querySelector<HTMLElement>(`[data-day="${targetDay}"]`);
        const list = dayPanelRef.current;
        if (!day || fromHere) {
          return;
        }
        if (list) {
          placeDayWithEvent(day, list, list.querySelector<HTMLElement>(`.ev[data-event-id="${selectedEventId}"]`));
        } else {
          revealElement(day, relocated ? "center" : "nearest");
        }
        return;
      }
      const row = root?.querySelector<HTMLElement>(`.ev[data-event-id="${selectedEventId}"]`);
      if (!row) {
        return;
      }
      if (relocated) {
        resetAside();
      }
      // a linha inteira à vista e, com o painel ao lado, o título do detalhe também (a folga no fim da
      // lista deixa os dois caberem juntos); a lista ainda pode estar na animação de entrada
      revealElement(row, relocated ? "center" : "nearest", asideRef.current);
    });
  }, [selectedEventId, calendarMode, targetVisible, currentStart, monthMode, targetDay, resetAside, internalId]);

  // no computador, o foco vai para o título do detalhe ao lado (no Modal, quem cuida é o próprio Modal)
  useEffect(() => {
    if (!side || selectedEventId === null) {
      return;
    }
    if (quietAsideFocus.current) {
      quietAsideFocus.current = false;
      return;
    }
    afterPaint(() => {
      const title = detailTitleRef.current;
      if (!title) {
        return;
      }
      title.focus({ preventScroll: true });
      const box = title.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        title.scrollIntoView({ block: "nearest" });
      }
    });
  }, [side, selectedEventId]);

  // foco pedido por uma ação (abrir do dia ou da grade)
  useEffect(() => {
    if (!pendingFocus.current) {
      return;
    }
    pendingFocus.current = null;
    window.requestAnimationFrame(() => detailTitleRef.current?.focus({ preventScroll: true }));
  });

  // celular: as categorias ficam numa faixa que rola de lado; a primeira escolhida fica à vista (sem mexer
  // quando ela já está inteira na faixa, para o chip tocado não sair de baixo do dedo)
  const pickedKey = allSelected ? "" : selectedCategories.join(",");
  useLayoutEffect(() => {
    const strip = catsRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1) {
      return;
    }
    const chip = strip.querySelector<HTMLElement>('.chip[aria-pressed="true"]');
    if (!chip) {
      return;
    }
    const edge = 24;
    const start = chip.offsetLeft;
    const end = start + chip.offsetWidth;
    if (start >= strip.scrollLeft + edge && end <= strip.scrollLeft + strip.clientWidth - edge) {
      return;
    }
    strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, start - edge));
  }, [pickedKey, calendarMode]);

  function dayButton(key: string | null) {
    return key ? (sectionRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`) ?? null) : null;
  }

  /** Dia escolhido na grade: fica onde estava na tela e, com `list`, a lista dele aparece logo abaixo. */
  function placeChosenDay() {
    const anchor = dayAnchor.current;
    dayAnchor.current = null;
    const button = dayButton(anchor?.key ?? null);
    if (!anchor || !button) {
      return;
    }
    if (anchor.list) {
      placeDay(button, anchor.top, dayPanelRef.current, dayTitleRef.current);
      dayTitleRef.current?.focus({ preventScroll: true });
      return;
    }
    // evento aberto pelo chip: só desfaz o deslocamento da lista de outro dia que saiu de cima (o Modal cobre a tela)
    const scroll = Math.max(0, Math.round(pageTop(button) - anchor.top));
    if (scroll !== Math.round(window.scrollY)) {
      window.scrollTo({ top: scroll, behavior: "instant" });
    }
  }

  // antes de pintar, para o dia escolhido não pular de lugar debaixo do cursor
  useLayoutEffect(() => {
    if (dayAnchor.current) {
      placeChosenDay();
    }
  });

  function setPeriod(value: TimeFilter) {
    // Próximos começa no primeiro mês à frente e Passados no mais recente (os dois saem do mês de hoje);
    // Todos tem tudo dos outros dois e fica no mês que está na tela
    if (value !== timeFilter && value !== "all") {
      let target = monthIndex(thisMonth());
      if (value === "past") {
        const pastKeys = [...bucketByMonth(scopedEvents.filter((event) => inPeriod(event, "past")), "past").keys()];
        target = pastKeys.length ? Math.max(...pastKeys) : target;
      }
      setCursor(indexMonth(target));
    }
    setTimeFilter(value);
    setPeriodNotice(null);
  }

  /** Mês escolhido na faixa, nas setas ou no pé da lista. */
  function goToMonth(index: number) {
    setCursor(indexMonth(index));
    // o detalhe ao lado é de um evento que não está no mês novo: fecha, para o painel não ficar solto
    if (calendarMode === "list" && selectedEvent && !(months.get(index) ?? []).some((item) => item.event.id === selectedEvent.id)) {
      onSelect(null);
    }
  }

  /**
   * Pé da lista: o mês novo começa no alto da tela, com o cabeçalho dele à vista, e o foco vai para o
   * título (o botão clicado pode sumir, e o Tab segue dali para a faixa e a lista).
   */
  function goToMonthTop(index: number) {
    goToMonth(index);
    afterPaint(() => {
      const title = monthTitleRef.current;
      const bar = title?.closest<HTMLElement>(".mpick-bar") ?? null;
      if (!bar) {
        return;
      }
      // no celular, abaixo do cabeçalho grudado (o scroll-margin do título)
      const margin = Math.max(EDGE_GAP, Number.parseFloat(getComputedStyle(title ?? bar).scrollMarginTop) || 0);
      const top = Math.max(0, Math.floor(settledBox(bar).top - margin));
      if (top < Math.round(window.scrollY)) {
        window.scrollTo({ top, behavior: "instant" });
      }
      title?.focus({ preventScroll: true });
    });
  }

  /**
   * "Ver em ..." da lista vazia e "Ver só os próximos" do aviso: o botão clicado some com a lista nova, e o
   * foco vai para a aba do período escolhido, que fica (como na Gestão), em vez de cair no início da página.
   */
  function showPeriod(value: TimeFilter, from: HTMLElement) {
    setPeriod(value);
    const tabs = (sectionRef.current ?? from.ownerDocument).querySelectorAll<HTMLButtonElement>('.seg[aria-label="Período"] button');
    tabs[timeFilters.findIndex((item) => item.value === value)]?.focus();
  }

  function clearAll() {
    setSearch("");
    // a aba Próximos, Passados ou Todos não é filtro: o período fica onde está
    setMineOnly(false);
    setClassFilter("all");
    selectAllCategories();
  }

  /** O botão clicado some da tela: o foco vai para o chip "Todas", que fica (e não cai no início da página). */
  function focusAllChip() {
    window.requestAnimationFrame(() => allChipRef.current?.focus());
  }

  function clearSearch() {
    setSearch("");
    focusAllChip();
  }

  function clearFilters() {
    clearAll();
    focusAllChip();
  }

  /** "Todas": volta todas as categorias, sem mexer na busca, no período nem na turma. */
  function selectAllCategories() {
    if (setCategories) {
      setCategories(allCategories);
    } else {
      allCategories.filter((category) => !selectedCategories.includes(category)).forEach(toggleCategory);
    }
  }

  /** "Limpar filtros": tira as categorias, a turma e o "Só meus"; a busca continua (ela tem o próprio X). */
  function clearNarrowing() {
    setMineOnly(false);
    setClassFilter("all");
    selectAllCategories();
    focusAllChip();
  }

  /**
   * "Mostrar todos N": o N conta só o que as categorias escondem (dentro da turma e do "Só meus"), então o botão
   * volta só as categorias; a turma e o "Só meus" ficam (o "Limpar filtros" é que tira tudo).
   */
  function showHiddenByCategory() {
    selectAllCategories();
    focusAllChip();
  }

  /**
   * As duas vistas mostram o mesmo mês. Ao ir para o Calendário com um evento aberto que está no mês, a
   * grade abre o dia dele, com a lista do dia e o evento marcado nela. O detalhe não vira diálogo sozinho:
   * ele abre com um clique no evento. Ao voltar para a Agenda, o mês continua, mesmo sem eventos no filtro
   * (a lista diz isso e oferece os meses vizinhos que têm).
   */
  function changeMode(mode: CalendarMode) {
    if (mode === calendarMode) {
      return;
    }
    if (mode === "month" && selectedEvent) {
      // um dia do evento já escolhido no mês (evento de vários dias) continua; senão, o 1º dia dele no mês
      const kept = selectedDay && occursOnDay(selectedEvent, parseDayKey(selectedDay)) ? parseDayKey(selectedDay) : null;
      const keptHere = kept !== null && kept.getFullYear() === cursor.year && kept.getMonth() === cursor.month;
      if (!keptHere && occursInMonth(selectedEvent, cursor)) {
        const monthStart = new Date(cursor.year, cursor.month, 1).getTime();
        setSelectedDay(dayKey(new Date(Math.max(eventSpan(selectedEvent).first, monthStart))));
      }
      setQuietId(selectedEvent.id);
    }
    setCalendarMode(mode);
  }

  function selectFromList(id: number) {
    setQuietId(null);
    setInternalId(id);
    // na busca a lista tem todos os meses: ao limpar a busca, a Agenda fica no mês do evento escolhido
    const chosen = term ? listEvents.find((event) => event.id === id) : null;
    if (chosen) {
      setCursor(listMonthOf(chosen, timeFilter));
    }
    onSelect(id);
  }

  function selectDay(key: string) {
    const button = dayButton(key);
    if (button) {
      dayAnchor.current = { key, top: pageTop(button) - window.scrollY, list: true };
    }
    if (key === selectedDay) {
      // o mesmo dia de novo: nada muda na tela, a lista dele volta a aparecer e recebe o foco
      placeChosenDay();
      return;
    }
    setSelectedDay(key);
  }

  /** Fecha a lista do dia e devolve o foco ao dia na grade, que fica onde está (à vista). */
  function closeDay() {
    const day = selectedDay;
    setSelectedDay(null);
    window.requestAnimationFrame(() => {
      const button = dayButton(day);
      if (button) {
        button.focus({ preventScroll: true });
        placeDay(button, pageTop(button) - window.scrollY, null, null);
      }
    });
  }

  function openFromDay(id: number) {
    setQuietId(null);
    setInternalId(id);
    pendingFocus.current = "detail";
    onSelect(id);
  }

  function openFromGrid(id: number, key: string) {
    const button = dayButton(key);
    if (button && key !== selectedDay) {
      dayAnchor.current = { key, top: pageTop(button) - window.scrollY, list: false };
    }
    setQuietId(null);
    setInternalId(id);
    setSelectedDay(key);
    pendingFocus.current = "detail";
    onSelect(id);
  }

  /**
   * Prévia do painel ao lado que vira escolha: a pessoa clicou ou apertou uma tecla no painel (o lembrete, o
   * Editar). O evento passa a ser o escolhido antes do clique, para as ações valerem para ele; a página não
   * rola e o foco fica onde a pessoa está.
   */
  function adoptPreview() {
    if (!previewEvent) {
      return;
    }
    quietAsideFocus.current = true;
    scrolledFor.current = { id: previewEvent.id, mode: calendarMode, start: new Date(previewEvent.startsAt).getTime() };
    setInternalId(previewEvent.id);
    onSelect(previewEvent.id);
  }

  /** Fecha o painel ao lado e devolve o foco para a linha de origem. */
  function closeAside() {
    const eventId = selectedEventId;
    if (eventId === null) {
      return;
    }
    onSelect(null);
    window.requestAnimationFrame(() => {
      const row = sectionRef.current?.querySelector<HTMLElement>(`.ev[data-event-id="${eventId}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Detalhe do evento. No Modal, `footerSlot` leva a ação principal para o rodapé fixo (à vista sem rolar). */
  function renderDetail(event: AcademicEvent, footerSlot?: HTMLElement | null) {
    // Na prévia (evento ainda não escolhido), a página manda a antecedência padrão; aqui vale a que está salva,
    // senão o painel mostraria uma alteração que ninguém fez.
    const previewSaved =
      event.id !== selectedEventId && event.reminder && event.reminder.enabled !== false ? event.reminder : null;
    return (
      <EventDetailContent
        key={event.id}
        canManage={canManageEvent(event)}
        event={event}
        footerSlot={footerSlot}
        reminderOffset={previewSaved ? String(previewSaved.offsetMinutes) : reminderOffset}
        saving={saving}
        setReminderOffset={setReminderOffset}
        cornerSpace={side}
        titleRef={detailTitleRef}
        onDelete={onDelete}
        onEdit={onEdit}
        onRemoveReminder={onRemoveReminder}
        onSaveReminder={onSaveReminder}
        onSetStatus={onSetStatus}
      />
    );
  }

  const title =
    role === "admin"
      ? "Cronograma institucional"
      : role === "teacher"
        ? "Cronograma das suas turmas"
        : role === "guardian"
          ? studentName
            ? `Cronograma de ${studentName}`
            : "Cronograma do aluno"
          : noClass
            ? "Cronograma"
            : "Cronograma da sua turma";

  // linha de contexto embaixo do título ("TADS 5, Matemática e Engenharia de Software"). Com busca, fica a de
  // antes dela (a lista filtrada pela busca mudaria a linha a cada letra)
  const liveContext = useMemo(
    () => contextText(role, allEvents ?? events, canManageEvent),
    [role, allEvents, events, canManageEvent]
  );
  const [baseContext, setBaseContext] = useState(liveContext);
  if (!term && baseContext !== liveContext) {
    setBaseContext(liveContext);
  }
  const context = term ? baseContext : liveContext;
  // aluno (a menor também) ou responsável sem prova nem trabalho no período (nenhum evento com turma): a turma
  // dele ("INF 3A"), como o subtítulo de quem já tem disciplinas, em vez de uma dica de uso solta. A página manda
  // em `classes` as turmas em que o aluno está matriculado (no responsável, o catálogo do aluno)
  const ownClasses =
    (role === "guardian" || role === "student") && classes.length > 0 && classes.length <= 3
      ? joinAnd([...new Set(classes.map((academicClass) => academicClass.name))])
      : null;
  // texto neutro ao dispositivo (sem "Clique" nem "Toque"); o convite a entrar numa turma vem primeiro
  const subtitle =
    role === "student" && noClass
      ? "Entre numa turma para ver as provas e os trabalhos dela"
      : (context ??
        ownClasses ??
        (monthMode ? "Escolha um dia para ver os eventos dele" : "Escolha um evento para ver os detalhes"));

  // nome do que a lista conta, no seletor de mês e nos vazios: "evento", "prova", "resultado"
  const monthNoun: MonthNoun = [nouns.one, nouns.many, nouns.none.toLowerCase()];

  /**
   * Linha da Agenda. As datas do campus (institucional, feriado, recesso) ficam numa linha mais baixa
   * (cronograma.css), e as provas e trabalhos se destacam no meio delas. O mês só aparece no bloco da data
   * quando o evento começou em outro mês (um recesso que vem de dezembro, na lista de janeiro).
   */
  function listRow(item: MonthItem, continued = false) {
    const { event } = item;
    return (
      <div
        key={event.id}
        className="crono-item"
        data-campus={campusCategories.includes(event.category) ? "" : undefined}
        // 2ª linha em diante do mesmo dia: sem o bloco da data (fica o espaço dele). O período e o "em N dias"
        // aparecem em toda linha, mesmo iguais aos da de cima (sem eles, a linha parecia sem data)
        data-cont={continued ? "" : undefined}
      >
        <EventRow
          event={event}
          hideClass={role === "student" || role === "guardian"}
          hideDate={continued}
          highlight={term || null}
          // a prévia do painel ao lado também fica marcada: a linha e o painel mostram o mesmo evento
          selected={(selectedEventId ?? previewEvent?.id) === event.id}
          showMonth={monthIndexOf(eventSpan(event).first) !== monthIndexOf(item.day)}
          // o ano do cabeçalho do mês (ou do grupo da busca): sob "Junho de 2027", o selo diz "MAI" e não "MAI 2027"
          refYear={new Date(item.day).getFullYear()}
          showTeacher={showTeacher(event)}
          onClick={() => selectFromList(event.id)}
        />
      </div>
    );
  }

  /** Linhas de um grupo, juntas por dia: a data aparece uma vez, na 1ª linha do dia. */
  function dayRows(items: MonthItem[]) {
    const days: MonthItem[][] = [];
    for (const item of items) {
      const last = days[days.length - 1];
      if (last && startOfDay(new Date(last[0].day)).getTime() === startOfDay(new Date(item.day)).getTime()) {
        last.push(item);
      } else {
        days.push([item]);
      }
    }
    return days.map((day) =>
      day.length === 1 ? (
        listRow(day[0])
      ) : (
        // o leitor de tela ouve o dia ao entrar no grupo (as linhas de baixo não têm a data)
        <div key={`dia-${day[0].event.id}`} className="crono-day" role="group" aria-label={dayTitle(new Date(day[0].day))}>
          {day.map((item, index) => listRow(item, index > 0))}
        </div>
      )
    );
  }

  function listGroups(groups: ListGroup[], ids?: string[]) {
    return groups.map((group, position) => (
      <div key={`${group.label}|${group.range ?? ""}`} className="crono-week">
        <p className="ev-group crono-gh" id={ids?.[position]} tabIndex={ids ? -1 : undefined}>
          {group.label}
          {group.range ? <span className="crono-gh-r"> {group.range}</span> : null}
        </p>
        <div className="crono-rows">{dayRows(group.items)}</div>
      </div>
    ));
  }

  /** Agenda de um mês: o seletor "‹ Novembro de 2026 ›", a lista do mês por semana e o pé com os meses vizinhos. */
  function monthList(index: number) {
    const shown = indexMonth(index);
    const forward = timeFilter !== "past";
    // o que começou num mês anterior (um recesso de maio que entra em junho) fica num grupo próprio, "Continua
    // de maio", fora das semanas. Na ordem da lista: no alto, ou no fim em Passados (do mais recente ao mais antigo)
    const todayStart = startOfDay(new Date()).getTime();
    const startedBefore = (item: MonthItem) => monthIndexOf(periodSpan(item.event, timeFilter, todayStart).first) < index;
    const carried = shownItems.filter(startedBefore);
    const ownGroups = groupByWeek(
      shownItems.filter((item) => !startedBefore(item)),
      shown.year
    );
    const carriedFrom = new Set(carried.map((item) => monthIndexOf(periodSpan(item.event, timeFilter, todayStart).first)));
    const carriedGroup: ListGroup[] = carried.length
      ? [
          {
            label:
              carriedFrom.size === 1
                ? `Continua de ${monthInText([...carriedFrom][0], indexMonth([...carriedFrom][0]).year !== shown.year)}`
                : `Começou antes de ${monthInText(index, false)}`,
            items: carried,
          },
        ]
      : [];
    const weekGroups = forward ? [...carriedGroup, ...ownGroups] : [...ownGroups, ...carriedGroup];

    // "2 eventos" não se separa no botão do vazio (a 360 px ele quebrava como "..., 2 / eventos")
    const nextTarget = keepCount(monthTarget(nextIndex, listCounts, goToMonthTop, monthNoun, index));
    const prevTarget = keepCount(monthTarget(prevIndex, listCounts, goToMonthTop, monthNoun, index));
    // quantos o filtro de categoria esconde neste mês (dentro do período, da turma e do "Só meus")
    const hiddenHere = allSelected ? 0 : Math.max(0, (allListMonths?.get(index)?.length ?? 0) - shownItems.length);
    const monthWord = monthInText(index, false);

    return (
      <>
        <MonthPicker
          card
          value={index}
          onChange={goToMonth}
          counts={listCounts}
          marks={listMarks}
          min={listBounds.min}
          max={listBounds.max}
          noun={monthNoun}
          titleRef={monthTitleRef}
        />

        {shownItems.length ? (
          <>
            <div key={`mes-${timeFilter}-${index}`} className="crono-list pop">
              {listGroups(weekGroups)}
            </div>
            {/* pé discreto: o mês vizinho do calendário, mesmo vazio ("Outubro, nenhum evento") */}
            <MonthNeighbors
              main={forward ? "next" : "prev"}
              prev={monthTarget(index > listBounds.min ? index - 1 : null, listCounts, goToMonthTop, monthNoun, index)}
              next={monthTarget(index < listBounds.max ? index + 1 : null, listCounts, goToMonthTop, monthNoun, index)}
            />
          </>
        ) : (
          // mês vazio: continua navegável, e o vazio leva ao mês com eventos mais perto no sentido da leitura
          <MonthEmpty
            title={`${nouns.none} em ${monthWord}`}
            next={forward ? nextTarget : prevTarget ? null : nextTarget}
            prev={forward ? (nextTarget ? null : prevTarget) : prevTarget}
            endText={!nextTarget && !prevTarget ? `Não há ${nouns.many} em outros meses` : forward && !nextTarget ? `Não há ${nouns.many} depois de ${monthWord}` : undefined}
            hidden={
              hiddenHere
                ? {
                    text: `${plural(hiddenHere, "evento escondido", "eventos escondidos")} pelo filtro neste mês.`,
                    actionLabel: "Mostrar todas",
                    onAction: showHiddenByCategory,
                  }
                : null
            }
          />
        )}
      </>
    );
  }

  /** Aviso fino acima da grade do Calendário: o mês sem eventos (ou sem resultado) e o atalho para o mais perto. */
  function calendarNote() {
    if (term && !calMonths.size) {
      return (
        <div className="callout past cg-note flex-wrap items-center">
          {/* a mesma frase da Agenda: com o filtro escondendo resultados, diz quantos e oferece mostrar */}
          <span className="min-w-0 flex-1 wrap-anywhere">
            {hiddenCount
              ? `Nada encontrado para "${term}" com o filtro, ${hiddenText}.`
              : `Nada encontrado para "${term}".${narrowed ? " Os filtros escolhidos também valem para a busca." : ""}`}
          </span>
          {hiddenCount ? (
            <button
              aria-label={`Mostrar todos, ${plural(hiddenCount, "resultado", "resultados")}`}
              className="btn btn-p btn-sm"
              onClick={showHiddenByCategory}
              type="button"
            >
              Mostrar todos
              <span className="crono-btn-n">{hiddenCount}</span>
            </button>
          ) : narrowed ? (
            <button className="btn btn-p btn-sm" onClick={clearNarrowing} type="button">
              Limpar filtros
            </button>
          ) : null}
          <button className={cx("btn btn-sm", hiddenCount || narrowed ? "btn-s" : "btn-p")} onClick={clearSearch} type="button">
            Limpar busca
          </button>
        </div>
      );
    }
    const go = (key: number) => {
      setCursor(indexMonth(key));
      setSelectedDay(null);
      // o botão some com o mês novo: o foco vai para o título do seletor
      afterPaint(() => sectionRef.current?.querySelector<HTMLElement>(".cg-card .mpick-title")?.focus({ preventScroll: true }));
    };
    const next = keepCount(monthTarget(nearestMonthWith(calCounts, cursorIndex, 1, calBounds), calCounts, go, monthNoun, cursorIndex));
    const prev = next ? null : keepCount(monthTarget(nearestMonthWith(calCounts, cursorIndex, -1, calBounds), calCounts, go, monthNoun, cursorIndex));
    const target = next ?? prev;
    return (
      <p className="month-note cg-note" role="status">
        <CalendarX2 className="month-note-ico" aria-hidden />
        <span>
          {term ? `Nenhum resultado para "${term}"` : nouns.none} em {monthInText(cursorIndex, false)}.
        </span>
        {target ? (
          <button className="month-note-link" onClick={target.onGo} type="button">
            {next ? "Próximo" : "Anterior"}: {target.title}, {target.count}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {!term && hiddenCount ? (
          <button
            aria-label={`Mostrar todas as categorias, ${plural(hiddenCount, "evento", "eventos")} em ${monthInText(cursorIndex, false)}`}
            className="month-note-link"
            onClick={showHiddenByCategory}
            type="button"
          >
            Mostrar todas ({hiddenCount})
          </button>
        ) : null}
      </p>
    );
  }

  /**
   * Busca na Agenda: os resultados de todos os meses juntos, um grupo por mês, 12 por página. No alto, quantos e
   * de que meses; com mais de um mês, um seletor leva à página do mês escolhido.
   */
  function searchList() {
    const monthCounts = new Map<number, number>();
    for (const item of searchItems) {
      const key = monthIndexOf(item.day);
      monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
    }
    const keys = [...monthCounts.keys()].sort((a, b) => a - b);
    const groups = groupByMonth(searchPage.items);
    const jump = (key: number) => {
      const position = searchItems.findIndex((item) => monthIndexOf(item.day) === key);
      if (position < 0) {
        return;
      }
      searchPage.setPage(Math.floor(position / SEARCH_PAGE) + 1);
      afterPaint(() => {
        const label = document.getElementById(`${listId}-m-${key}`);
        if (!label) {
          return;
        }
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        label.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
        label.focus({ preventScroll: true });
      });
    };
    const monthOptions: SelectOption[] = keys.map((key) => ({
      value: String(key),
      label: indexTitle(key),
      count: monthCounts.get(key) ?? 0,
    }));
    const total = searchItems.length;
    return (
      <>
        <div className="crono-range-bar">
          <p ref={searchHeadRef} className="crono-range" tabIndex={-1}>
            <b>{plural(total, "resultado", "resultados")}</b> {monthSpanText(keys[0], keys[keys.length - 1])}
            {/* o filtro de categoria continua valendo na busca: a linha diz quantos ele esconde (decisão 14) */}
            {hiddenCount ? (
              <>
                , {hiddenText}{" "}
                <button className="link" onClick={showHiddenByCategory} type="button">
                  Mostrar todos
                </button>
              </>
            ) : null}
          </p>
          {keys.length > 1 ? (
            <Select
              ariaLabel="Ir para o mês"
              className="crono-range-pick"
              options={monthOptions}
              placeholder="Ir para o mês"
              prefix="Mês:"
              size="sm"
              value={String(monthIndexOf(searchPage.items[0]?.day ?? Date.now()))}
              variant="filter"
              width="auto"
              onChange={(value) => jump(Number(value))}
            />
          ) : null}
        </div>
        <div key={`busca-${timeFilter}-${searchPage.page}`} className="crono-list pop">
          {listGroups(groups, groups.map((group) => `${listId}-m-${group.key}`))}
        </div>
        <Pager className="crono-search-pager" paged={searchPage} noun={["resultado", "resultados"]} focusRef={searchHeadRef} />
      </>
    );
  }

  function listBody() {
    if (listEvents.length && term) {
      return searchList();
    }
    if (listEvents.length && shownIndex !== null) {
      return monthList(shownIndex);
    }

    const seeOther =
      otherPeriod && otherCount ? (
        <button className="btn btn-s btn-sm" onClick={(click) => showPeriod(otherPeriod, click.currentTarget)} type="button">
          Ver em {periodNames[otherPeriod]}
        </button>
      ) : null;
    const otherHint =
      otherPeriod && otherCount
        ? `Há ${term ? plural(otherCount, "resultado", "resultados") : plural(otherCount, "evento", "eventos")} em ${periodNames[otherPeriod]}.`
        : undefined;

    if (term) {
      // o filtro de categoria esconde resultados deste período: a tela diz quantos e oferece mostrar (decisão 14)
      if (hiddenCount) {
        return (
          <ListEmpty
            icon={SearchX}
            title={`Nada encontrado para "${term}" com o filtro.`}
            hint={`${hiddenText}.`}
            actions={
              <>
                <button
                  aria-label={`Mostrar todos, ${plural(hiddenCount, "resultado", "resultados")}`}
                  className="btn btn-s btn-sm"
                  onClick={showHiddenByCategory}
                  type="button"
                >
                  Mostrar todos
                  <span className="crono-btn-n">{hiddenCount}</span>
                </button>
                <button className="btn btn-g btn-sm" onClick={clearSearch} type="button">
                  Limpar busca
                </button>
              </>
            }
          />
        );
      }
      // sem resultado: uma ação só (a busca é o único filtro); com "Só meus" ou turma, o "Limpar filtros" também
      return (
        <ListEmpty
          icon={SearchX}
          title={otherHint ? `Nada encontrado em ${periodNames[timeFilter]} para "${term}".` : `Nada encontrado para "${term}".`}
          hint={otherHint ?? (narrowed ? "Os filtros escolhidos também valem para a busca." : undefined)}
          actions={
            <>
              {seeOther}
              {narrowed ? (
                <button className={seeOther ? "btn btn-g btn-sm" : "btn btn-s btn-sm"} onClick={clearNarrowing} type="button">
                  Limpar filtros
                </button>
              ) : null}
              <button className={seeOther || narrowed ? "btn btn-g btn-sm" : "btn btn-s btn-sm"} onClick={clearSearch} type="button">
                Limpar busca
              </button>
            </>
          }
        />
      );
    }

    return (
      <ListEmpty
        icon={timeFilter === "past" ? History : Inbox}
        title={
          singleCategory
            ? `${nouns.none} ${timeFilter === "upcoming" ? "nos próximos dias" : timeFilter === "past" ? "antes de hoje" : "no cronograma"}.`
            : timeFilter === "upcoming"
              ? "Nenhum evento nos próximos dias."
              : timeFilter === "past"
                ? "Nenhum evento passado."
                : "Nenhum evento encontrado."
        }
        hint={narrowed ? "Ajuste ou limpe os filtros para ver mais." : otherHint}
        actions={
          seeOther || narrowed ? (
            <>
              {seeOther}
              {narrowed ? (
                <button className={seeOther ? "btn btn-g btn-sm" : "btn btn-s btn-sm"} onClick={clearNarrowing} type="button">
                  Limpar filtros
                </button>
              ) : null}
            </>
          ) : undefined
        }
      />
    );
  }

  // contador no fim da linha dos filtros da Agenda: sem filtro, o total; com filtro, quanto sobra. No
  // Calendário, a contagem fica no seletor de mês. No celular ele fica só para o leitor de tela
  const counter =
    calendarMode === "list" && !(term && listEvents.length) ? (
      <span className="crono-total" role="status">
        {hasFilter ? counterText : `${plural(periodCounts.all, "evento", "eventos")} no total`}
      </span>
    ) : null;

  const classOptions: SelectOption[] = [
    { value: "all", label: "Todas" },
    { value: "official", label: "Só da instituição", description: "Datas sem turma, para todos" },
    ...classes.map((academicClass) => ({ value: String(academicClass.id), label: academicClass.name, group: "Turmas" })),
  ];

  // a busca fica só no menu (no celular, na gaveta); aqui aparece o chip dela, que limpa a busca. O termo longo
  // termina em reticência, e o termo inteiro fica no title e no nome do X
  const searchChip = term ? (
    <span className="chip picked crono-term min-w-0 max-w-full pr-1.5" title={`Busca: ${term}`}>
      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        Busca: <b>{term}</b>
      </span>
      <button
        className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-surface-2 pointer-coarse:after:absolute pointer-coarse:after:-inset-2"
        aria-label={`Limpar busca por "${term}"`}
        onClick={clearSearch}
        title={`Limpar busca por "${term}"`}
        type="button"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  ) : null;

  // busca sem nada em período nenhum: as abas "Próximos 0 | Passados 0 | Todos 0" repetiriam o "Nada encontrado"
  const periodSeg =
    calendarMode === "list" && !(term && periodCounts.upcoming + periodCounts.past === 0) ? (
      <Segmented label="Período">
        {timeFilters.map((item) => (
          <button
            key={item.value}
            className={cx("crono-period", timeFilter === item.value && "on")}
            aria-pressed={timeFilter === item.value}
            onClick={() => setPeriod(item.value)}
            type="button"
          >
            {item.label}
            <span className="n">{periodCounts[item.value]}</span>
          </button>
        ))}
      </Segmented>
    ) : null;

  const mineSwitch =
    role === "teacher" ? (
      <button
        aria-checked={mineOnly}
        className={cx("sw crono-mine", mineOnly && "on")}
        onClick={() => setMineOnly(!mineOnly)}
        role="switch"
        title="Só os eventos que você publicou"
        type="button"
      >
        <i aria-hidden />
        Só meus eventos
      </button>
    ) : null;

  const classSelect =
    role === "admin" && classes.length ? (
      <Select
        active={classFilter !== "all"}
        ariaLabel="Turma"
        className="crono-class"
        options={classOptions}
        prefix="Turma:"
        size="sm"
        value={classFilter}
        variant="filter"
        width="auto"
        onChange={(value) => setClassFilter(value)}
      />
    ) : null;

  const clearLink = showClear ? (
    <button className="link max-sm:hidden" onClick={clearNarrowing} type="button">
      Limpar filtros
    </button>
  ) : null;

  const hiddenLine = calHiddenLine ? (
    <span className="crono-hidden">
      <span className="text-sm font-semibold text-ink-3">{hiddenText}</span>
      <button
        aria-label={`Mostrar todos, ${plural(hiddenCount, "resultado", "resultados")}`}
        className="link"
        onClick={showHiddenByCategory}
        type="button"
      >
        Mostrar todos
      </button>
    </span>
  ) : null;

  // categorias: no celular, uma faixa de uma linha que rola de lado, com o "Limpar filtros" no fim
  const categoryChips = (
    <div ref={catsRef} className="chips crono-cats" role="group" aria-label="Categorias" hidden={hideCats}>
      <button
        ref={allChipRef}
        className={cx("chip", allSelected && "on")}
        aria-pressed={allSelected}
        onClick={selectAllCategories}
        type="button"
      >
        {allSelected ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
        Todas
        <span className="n">{totalCount}</span>
      </button>
      {allCategories.map((category) => {
        const picked = !allSelected && selectedCategories.includes(category);
        const meta = categoryMeta[category];
        // sem nada para mostrar, o chip some, mesmo escolhido ("Trabalhos 0" marcado parecia um filtro
        // que mostra algo). Só fica quando nenhuma escolhida tem eventos: aí a pessoa vê o que está ativo
        if (allEvents && categoryCounts[category] === 0 && !(picked && !pickedWithEvents)) {
          return null;
        }
        return (
          <button
            key={category}
            className={cx("chip", picked && "on")}
            aria-pressed={picked}
            onClick={() => {
              // com "Todas" ativo (mesmo por uma escolha que cobre todas as que têm eventos), mostra só a clicada
              if (allSelected && setCategories) {
                setCategories([category]);
                return;
              }
              // desmarcar a última escolhida que tem eventos volta a Todas, em vez de revelar uma
              // escolhida escondida com 0 ("Trabalhos 0") e deixar a lista vazia
              const rest = selectedCategories.filter((item) => item !== category);
              if (picked && setCategories && !rest.some((item) => categoryCounts[item] > 0)) {
                setCategories(allCategories);
                return;
              }
              toggleCategory(category);
            }}
            type="button"
          >
            <span className={cx("dot", meta.accent)} aria-hidden />
            {meta.label}
            <span className="n">{categoryCounts[category]}</span>
          </button>
        );
      })}
      {showClear ? (
        <button className="link crono-clear sm:hidden" onClick={clearNarrowing} type="button">
          Limpar filtros
        </button>
      ) : null}
    </div>
  );

  const firstRowItems = [searchChip, periodSeg, mineSwitch, classSelect].some(Boolean);

  return (
    <div ref={sectionRef} className="crono">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Segmented label="Modo de visualização">
            <SegmentedButton active={calendarMode === "list"} onClick={() => changeMode("list")} icon={ListChecks} label="Agenda" />
            <SegmentedButton active={calendarMode === "month"} onClick={() => changeMode("month")} icon={CalendarRange} label="Calendário" />
          </Segmented>
        }
      />

      {/* filtros fora do card, como na amostra: na Agenda, o período, o "Só meus" e a turma numa linha e as
          categorias embaixo; no Calendário, tudo numa linha só */}
      {calendarMode === "list" ? (
        <div className="crono-fbar">
          {firstRowItems || counter ? (
            <div className="crono-frow">
              {searchChip}
              {periodSeg}
              {mineSwitch}
              {classSelect}
              <span className="crono-fright">
                {counter}
                {clearLink}
              </span>
            </div>
          ) : null}
          {categoryChips}
        </div>
      ) : (
        <div className="crono-fbar is-cal">
          <div className="crono-frow">
            {searchChip}
            {mineSwitch}
            {classSelect}
            {firstRowItems && !hideCats ? <span className="crono-vr" aria-hidden /> : null}
            {categoryChips}
            {clearLink || hiddenLine ? (
              <span className={cx("crono-fright", !hiddenLine && "max-sm:hidden")}>
                {hiddenLine}
                {clearLink}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {calendarMode === "list" && periodNotice ? (
        <div className="callout blue crono-notice flex-wrap items-center">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          {/* o aviso traz o título do evento: uma palavra mais larga que a tela quebra em vez de passar dela */}
          <span className="min-w-0 flex-1 wrap-anywhere">{periodNotice}</span>
          <button className="link" onClick={(click) => showPeriod("upcoming", click.currentTarget)} type="button">
            Ver só os próximos
          </button>
        </div>
      ) : null}
      {calendarMode === "list" && term && listEvents.length && otherPeriod && otherCount ? (
        <div className="callout blue crono-notice flex-wrap items-center">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            Também há {plural(otherCount, "resultado", "resultados")} em {periodNames[otherPeriod]}.
          </span>
          <button className="link" onClick={() => setPeriod(otherPeriod)} type="button">
            Ver em {periodNames[otherPeriod]}
          </button>
        </div>
      ) : null}
      {hiddenByFilters && selectedEvent ? (
        <div className="callout blue crono-notice flex-wrap items-center">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 wrap-anywhere">
            &quot;{selectedEvent.title}&quot; não aparece na lista com os filtros atuais.
          </span>
          <button className="link" onClick={clearFilters} type="button">
            {term ? "Limpar busca e filtros" : "Limpar filtros"}
          </button>
        </div>
      ) : null}

      <div className={cx("crono-layout", asideOpen && "has-aside")}>
        {calendarMode === "list" ? (
          // self-start: com o detalhe ao lado, o card termina no fim do conteúdo; na lista longa, a folga do
          // useAsideRoom leva o fim até o do painel
          <section ref={listRef} className="card rise crono-listcard min-w-0 self-start" aria-label="Eventos do mês">
            {listBody()}
            {/* folga no fim da lista com o detalhe ao lado (useAsideRoom): a linha escolhida e o começo do
                detalhe cabem juntos na tela, e no fim da página os dois cards terminam juntos */}
            {asideOpen ? <div ref={asideRoomRef} aria-hidden /> : null}
          </section>
        ) : (
          <MonthCalendar
            cursor={cursor}
            dayPanel={
              // a lista do dia entra na grade, embaixo da semana dele; a grade continua larga
              compact && selectedDayDate ? (
                <section
                  key={selectedDay}
                  ref={dayPanelRef}
                  className="cg-day pop"
                  aria-label={`Eventos de ${dayTitle(selectedDayDate)}`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !event.defaultPrevented) {
                      event.preventDefault();
                      closeDay();
                    }
                  }}
                >
                  <button className="ib sm ghost cg-day-x" aria-label="Fechar dia" onClick={closeDay} title="Fechar dia" type="button">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                  <DayEvents
                    date={selectedDayDate}
                    events={dayEvents}
                    hideClass={role === "student" || role === "guardian"}
                    highlight={term || null}
                    level={3}
                    selectedEventId={selectedEventId}
                    showTeacher={showTeacher}
                    titleRef={dayTitleRef}
                    onNewEventOn={onNewEventOn}
                    onOpen={openFromDay}
                  />
                </section>
              ) : null
            }
            emptyNote={calendarNote()}
            events={scopedEvents}
            monthEventCount={monthEvents.length}
            picker={
              <MonthPicker
                card
                value={cursorIndex}
                onChange={(key) => setCursor(indexMonth(key))}
                counts={calCounts}
                marks={calMarks}
                min={calBounds.min}
                max={calBounds.max}
                noun={monthNoun}
              />
            }
            selectedDay={selectedDay}
            selectedEventId={selectedEventId}
            setCursor={setCursor}
            onOpenEvent={openFromGrid}
            onSelectDay={selectDay}
          />
        )}

        {/* computador, na Agenda: detalhe ao lado, que acompanha a página (sem rolagem própria) */}
        {asideOpen && detailEvent ? (
          <aside
            ref={asideRef}
            className="card rise crono-detail relative min-w-0 xl:sticky xl:top-5"
            style={{ "--i": 1 } as CSSProperties}
            aria-label={selectedEvent ? "Detalhe do evento" : "Próximo evento da lista"}
            onKeyDown={(event) => {
              if (selectedEvent && event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                closeAside();
              }
            }}
            // prévia: usar o painel (clique ou tecla de ação) escolhe o evento antes, para a ação valer para ele
            onKeyDownCapture={
              selectedEvent
                ? undefined
                : (event) => {
                    if ((event.key === "Enter" || event.key === " ") && isControl(event.target)) {
                      adoptPreview();
                    }
                  }
            }
            onPointerDownCapture={
              selectedEvent
                ? undefined
                : (event) => {
                    if (isControl(event.target)) {
                      adoptPreview();
                    }
                  }
            }
          >
            {/* a prévia não tem o que fechar: o X aparece com um evento escolhido */}
            {selectedEvent ? (
              <button
                className="ib sm ghost crono-detail-x"
                aria-label="Fechar detalhe"
                onClick={closeAside}
                title="Fechar detalhe"
                type="button"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <div key={`evento-${detailEvent.id}`} className="pop">
              {renderDetail(detailEvent)}
            </div>
          </aside>
        ) : null}
      </div>

      {/* celular, tablet e Calendário: detalhe no Modal, com o foco no título do evento. O evento que
          veio da Agenda ao trocar de modo só fica marcado: o Modal abre quando a pessoa clica nele. */}
      {compact && selectedEvent && !quiet ? (
        <Modal
          title="Detalhes do evento"
          initialFocusRef={detailTitleRef}
          onClose={() => onSelect(null)}
          // rodapé fixo com a ação principal (Editar); sem ação, ele some (cronograma.css)
          footer={<div ref={setModalFoot} className="ev-foot" />}
        >
          {renderDetail(selectedEvent, modalFoot)}
        </Modal>
      ) : null}
    </div>
  );
}

/** Junta nomes em frase: "A", "A e B", "A, B e C". */
function joinAnd(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/**
 * Contexto embaixo do título: as turmas e as disciplinas dos eventos ("TADS 5, Matemática e Engenharia de
 * Software"). Docente: só os eventos dele. Com mais de 3 disciplinas, só a contagem ("6 disciplinas").
 * Administração: todas as turmas. Sem turma nenhuma, null (fica a dica de uso).
 */
function contextText(role: UserRole, list: AcademicEvent[], canManage: (event: AcademicEvent) => boolean) {
  if (role === "admin") {
    return "Datas da instituição e eventos de todas as turmas";
  }
  const own = role === "teacher" ? list.filter(canManage) : list;
  const unique = (values: Array<string | null | undefined>) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const classNames = unique(own.map((event) => event.academicClass?.name));
  if (!classNames.length) {
    return null;
  }
  const subjects = unique(own.map((event) => event.subject?.name));
  const subjectText = subjects.length > 3 ? `${subjects.length} disciplinas` : joinAnd(subjects);
  return [classNames.join(", "), subjectText].filter(Boolean).join(", ");
}
